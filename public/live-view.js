// The live editor. One `contenteditable` element shows the note as rendered
// lines. The line with the caret, and the span the caret is in, show their raw
// Markdown; everything else shows the result.
//
// The note is a plain string. The browser never owns it: every edit arrives in
// `beforeinput`, is cancelled, and is applied to the string, and then the lines
// it touched are drawn again. The one exception is composition (an input method
// editor or a phone keyboard), which the browser must own until it ends.
//
// The element gets the parts of the <textarea> interface that app.js uses:
// value, selectionStart, selectionEnd, setSelectionRange, setRangeText,
// disabled, focus, and an `input` event after each change.
(function (root) {
  const { tokenizeDocument, retokenize, revealedMarks } = root.NoteTokenizer;
  const HISTORY_LIMIT = 200;
  const TYPING_PAUSE = 1000;

  function safeUrl(href) {
    return /^(https?:\/\/|\/)/i.test(href) ? href : null;
  }

  function create(host) {
    let text = '';
    let lines = [''];
    let tokens = [];
    let starts = [0];
    let composing = false;
    let pointerDown = false;
    let activeLine = -1;
    let disabled = false;
    const undoStack = [];
    const redoStack = [];
    let lastKind = '';
    let lastTime = 0;

    host.classList.add('live-view');
    host.setAttribute('role', 'textbox');
    host.setAttribute('aria-multiline', 'true');
    host.contentEditable = 'plaintext-only';
    if (host.contentEditable !== 'plaintext-only') host.contentEditable = 'true';

    // ---- Offsets -------------------------------------------------------

    function rebuildStarts() {
      starts = new Array(lines.length);
      let position = 0;
      for (let index = 0; index < lines.length; index += 1) {
        starts[index] = position;
        position += lines[index].length + 1;
      }
    }

    // The last line that starts at or before the offset.
    function lineAt(offset) {
      let low = 0;
      let high = lines.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= offset) low = middle; else high = middle - 1;
      }
      return low;
    }

    // A DOM position as an offset into the note. Hidden marks keep their text in
    // the DOM, so the length of the text before the position is the column.
    function domToOffset(node, offset) {
      if (node === host) return offset >= lines.length ? text.length : starts[offset];
      let line = node;
      while (line && line.parentNode !== host) line = line.parentNode;
      if (!line) return null;
      const range = document.createRange();
      range.setStart(line, 0);
      range.setEnd(node, offset);
      return starts[Array.prototype.indexOf.call(host.children, line)] + range.toString().length;
    }

    function offsetToPoint(offset) {
      const index = lineAt(offset);
      const line = host.children[index];
      const column = offset - starts[index];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let position = 0;
      let hiddenMatch = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const end = position + node.data.length;
        if (column >= position && column <= end) {
          // A caret inside a hidden mark would not show. Prefer a visible node.
          if (!node.parentNode.classList.contains('live-hide')) return [node, column - position];
          hiddenMatch = hiddenMatch || [node, column - position];
        }
        position = end;
      }
      return hiddenMatch || [line, 0];
    }

    // [anchor, focus] as offsets, or null when the selection is elsewhere.
    function readSelection() {
      const selection = document.getSelection();
      if (!selection.rangeCount || !host.contains(selection.anchorNode)) return null;
      const anchor = domToOffset(selection.anchorNode, selection.anchorOffset);
      const focus = domToOffset(selection.focusNode, selection.focusOffset);
      return anchor === null || focus === null ? null : [anchor, focus];
    }

    function writeSelection(anchor, focus) {
      const [anchorNode, anchorOffset] = offsetToPoint(anchor);
      const [focusNode, focusOffset] = offsetToPoint(focus);
      document.getSelection().setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    }

    // ---- Drawing -------------------------------------------------------

    function signature(token, caret) {
      if (caret === null) return '-';
      return '+' + revealedMarks(token, caret).map(mark => mark[0] + ':' + mark[1]).join(',');
    }

    // The marks of a line that the editor may hide. An ordered list keeps its
    // number, and a code fence keeps its text, so the reader can see both.
    function hideableMarks(token, line) {
      if (token.type === 'fence' || (token.type === 'list' && token.ordered)) return [];
      if (token.type === 'image') return [[0, line.length]];
      return token.marks;
    }

    function inside(ranges, start, end) {
      return ranges.some(range => range[0] <= start && end <= range[1]);
    }

    function widgetFor(token) {
      if (token.type === 'task') {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'live-box';
        box.checked = token.done;
        box.tabIndex = -1;
        box.contentEditable = 'false';
        box.disabled = disabled;
        return box;
      }
      if (token.type === 'image') return imageWidget(token.href, token.alt, 'live-image');
      return null;
    }

    function imageWidget(href, alt, className) {
      const url = safeUrl(href);
      if (!url) return null;
      const holder = document.createElement('span');
      holder.className = className;
      holder.contentEditable = 'false';
      const image = document.createElement('img');
      image.src = url;
      image.alt = alt;
      image.loading = 'lazy';
      holder.append(image);
      return holder;
    }

    // Rebuild one line from its token. `caret` is the column of the caret, or
    // null when the caret is on another line.
    function drawLine(index, caret) {
      const element = host.children[index];
      const line = lines[index];
      const token = tokens[index];
      const revealed = revealedMarks(token, caret);
      const hideable = hideableMarks(token, line);
      const allMarks = hideable.concat(...token.spans.map(span => span.marks));

      const cuts = new Set([0, line.length]);
      for (const range of allMarks) { cuts.add(range[0]); cuts.add(range[1]); }
      for (const span of token.spans) { cuts.add(span.start); cuts.add(span.end); }
      const points = [...cuts].sort((a, b) => a - b);

      const nodes = [];
      for (let k = 0; k + 1 < points.length; k += 1) {
        const start = points[k];
        const end = points[k + 1];
        const piece = line.slice(start, end);
        const classes = [];
        let link = null;
        for (const span of token.spans) {
          if (span.start > start || end > span.end) continue;
          classes.push('s-' + span.type);
          if (span.type === 'link') link = span;
        }
        if (inside(allMarks, start, end)) classes.push(inside(revealed, start, end) ? 'live-mark' : 'live-hide');
        if (!classes.length) nodes.push(document.createTextNode(piece));
        else {
          const span = document.createElement('span');
          span.className = classes.join(' ');
          span.textContent = piece;
          if (link) span.dataset.href = link.href;
          nodes.push(span);
        }
        // A picture inside a line follows its syntax. It stays when the syntax shows.
        for (const span of token.spans) {
          if (span.type !== 'image' || span.end !== end || token.type === 'image') continue;
          const picture = imageWidget(span.href, span.alt, 'live-inline-image');
          if (picture) nodes.push(picture);
        }
      }
      if (!line) nodes.push(document.createElement('br'));

      const widget = widgetFor(token);
      if (widget) {
        if (token.type === 'task') nodes.unshift(widget); else nodes.push(widget);
      }

      let className = 'll ll-' + token.type;
      if (token.level) className += ' ll-h' + token.level;
      if (token.ordered) className += ' ll-ordered';
      if (token.done) className += ' ll-done';
      if (caret !== null) className += ' ll-active';
      element.className = className;
      element.style.setProperty('--indent', token.indent ? String(token.indent / 2) : '0');
      element.replaceChildren(...nodes);
      token.signature = signature(token, caret);
    }

    function drawRange(from, to) {
      for (let index = from; index < to; index += 1) drawLine(index, null);
    }

    function markEmpty() {
      host.toggleAttribute('data-empty', text === '');
    }

    function drawAll() {
      tokens = tokenizeDocument(lines);
      host.replaceChildren(...lines.map(() => document.createElement('div')));
      drawRange(0, lines.length);
      activeLine = -1;
      markEmpty();
    }

    // Show the raw Markdown of the line, and of the span, that holds the caret,
    // and hide it again where the caret has left. Draws only a line whose marks
    // changed. A pointer drag is left alone until it ends: replacing the nodes
    // under a drag would cut the selection short.
    function syncReveal() {
      if (composing || pointerDown) return;
      const selection = readSelection();
      const focus = selection ? selection[1] : null;
      const caretLine = focus === null ? -1 : lineAt(focus);
      let redrawn = false;
      for (const index of new Set([caretLine, activeLine])) {
        if (index < 0 || index >= lines.length) continue;
        const caret = index === caretLine ? focus - starts[index] : null;
        if (signature(tokens[index], caret) !== tokens[index].signature) {
          drawLine(index, caret);
          redrawn = true;
        }
      }
      activeLine = caretLine;
      if (redrawn && selection) writeSelection(selection[0], selection[1]);
    }

    // ---- Edits ---------------------------------------------------------

    // Replace text[a, b) and bring the lines, tokens and DOM up to date. Only
    // the lines that differ are touched, so the line under the caret survives.
    function applyEdit(a, b, insert) {
      text = text.slice(0, a) + insert + text.slice(b);
      const before = lines;
      const after = text.split('\n');
      let first = 0;
      const shortest = Math.min(before.length, after.length);
      while (first < shortest && before[first] === after[first]) first += 1;
      let oldEnd = before.length;
      let newEnd = after.length;
      while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }

      lines = after;
      rebuildStarts();
      tokens = tokens.slice(0, first).concat(new Array(newEnd - first), tokens.slice(oldEnd));
      for (let index = oldEnd - 1; index >= first; index -= 1) host.children[index].remove();
      const reference = host.children[first] || null;
      for (let index = first; index < newEnd; index += 1) host.insertBefore(document.createElement('div'), reference);

      if (activeLine >= oldEnd) activeLine += newEnd - oldEnd;
      else if (activeLine >= first) activeLine = -1;
      drawRange(first, retokenize(lines, tokens, first));
      markEmpty();
    }

    function remember(kind) {
      const now = performance.now();
      const continuing = kind === 'insertText' && lastKind === 'insertText' && now - lastTime < TYPING_PAUSE;
      if (!continuing) {
        undoStack.push({ text, selection: readSelection() || [text.length, text.length] });
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      }
      redoStack.length = 0;
      lastKind = kind;
      lastTime = now;
    }

    function announce(inputType) {
      host.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    }

    // One user edit: text[a, b) becomes `insert`, and the caret follows it.
    function commit(a, b, insert, kind, caret = a + insert.length) {
      remember(kind);
      applyEdit(a, b, insert);
      writeSelection(caret, caret);
      syncReveal();
      announce(kind);
    }

    function travel(from, to) {
      const snapshot = from.pop();
      if (!snapshot) return;
      to.push({ text, selection: readSelection() || [text.length, text.length] });
      applyEdit(0, text.length, snapshot.text);
      writeSelection(snapshot.selection[0], snapshot.selection[1]);
      syncReveal();
      lastKind = '';
      announce('history');
    }

    function deletionRange(event, a, b) {
      if (a !== b) return [a, b];
      const target = event.getTargetRanges && event.getTargetRanges()[0];
      if (target) {
        const start = domToOffset(target.startContainer, target.startOffset);
        const end = domToOffset(target.endContainer, target.endOffset);
        if (start !== null && end !== null && start !== end) return [Math.min(start, end), Math.max(start, end)];
      }
      return event.inputType.includes('Forward') ? [a, Math.min(text.length, a + 1)] : [Math.max(0, a - 1), a];
    }

    // Enter inside a list item, task or quote starts the next one. Enter on an
    // empty item removes its marker and ends the list. Returns true when handled.
    function continueBlock(a, b) {
      if (a !== b) return false;
      const index = lineAt(a);
      const token = tokens[index];
      const line = lines[index];
      if (!['list', 'task', 'quote'].includes(token.type)) return false;
      const markerEnd = token.marks[0][1];
      if (a - starts[index] < markerEnd) return false;
      if (line.slice(markerEnd).trim() === '') {
        commit(starts[index], starts[index] + line.length, '', 'insertParagraph', starts[index]);
        return true;
      }
      let prefix = line.slice(0, markerEnd);
      if (token.type === 'task') prefix = line.slice(0, token.checkbox[0]) + '[ ] ';
      else if (token.ordered) prefix = prefix.replace(/\d+/, number => String(Number(number) + 1));
      commit(a, a, '\n' + prefix, 'insertParagraph');
      return true;
    }

    host.addEventListener('beforeinput', event => {
      // The browser must own the DOM while an input method is composing.
      if (composing || event.isComposing) return;
      event.preventDefault();
      if (disabled) return;
      const type = event.inputType;
      if (type === 'historyUndo') { travel(undoStack, redoStack); return; }
      if (type === 'historyRedo') { travel(redoStack, undoStack); return; }
      const selection = readSelection();
      if (!selection) return;
      const a = Math.min(selection[0], selection[1]);
      const b = Math.max(selection[0], selection[1]);

      if (type.startsWith('delete')) {
        const [start, end] = deletionRange(event, a, b);
        if (start !== end) commit(start, end, '', type, start);
        return;
      }
      // Moving text by drag would copy it; the source would stay. Ignore it.
      if (!type.startsWith('insert') || type === 'insertFromDrop') return;
      let insert;
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        if (continueBlock(a, b)) return;
        insert = '\n';
      } else insert = event.data ?? (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
      insert = (insert || '').replace(/\r\n?/g, '\n');
      if (insert) commit(a, b, insert, type);
    });

    // The browser has nothing to undo, because every edit was cancelled above,
    // and then it sends no `historyUndo` event. The shortcuts are handled here.
    host.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || composing) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) travel(undoStack, redoStack);
      else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) travel(redoStack, undoStack);
      else return;
      event.preventDefault();
    });

    // Copy and cut take the exact Markdown of the selection, including marks
    // that are hidden on the screen.
    host.addEventListener('copy', event => {
      const [start, end] = selectionRange();
      if (start === end) return;
      event.clipboardData.setData('text/plain', text.slice(start, end));
      event.preventDefault();
    });
    host.addEventListener('cut', event => {
      const [start, end] = selectionRange();
      event.preventDefault();
      if (start === end || disabled) return;
      event.clipboardData.setData('text/plain', text.slice(start, end));
      commit(start, end, '', 'deleteByCut', start);
    });

    // After composition the DOM holds the truth. Read it back into the string.
    function adoptDom() {
      const elements = Array.from(host.children);
      const clean = elements.every(element => element.classList.contains('ll'));
      const next = clean ? elements.map(element => element.textContent) : host.innerText.replace(/\n$/, '').split('\n');
      const changed = next.length !== lines.length || next.some((line, index) => line !== lines[index]);
      if (!changed) return;
      lines = next;
      text = lines.join('\n');
      rebuildStarts();
      const selection = clean ? readSelection() : null;
      drawAll();
      if (selection) writeSelection(selection[0], selection[1]);
      else writeSelection(text.length, text.length);
      remember('composition');
      announce('insertCompositionText');
    }

    host.addEventListener('compositionstart', () => { composing = true; });
    host.addEventListener('compositionend', () => {
      composing = false;
      adoptDom();
      syncReveal();
    });

    // ---- Pointer and selection ----------------------------------------

    host.addEventListener('pointerdown', event => {
      if (event.target.closest && event.target.closest('.live-box')) return;
      pointerDown = true;
    });
    const release = () => { if (pointerDown) { pointerDown = false; syncReveal(); } };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('selectionchange', syncReveal);
    host.addEventListener('blur', () => {
      if (activeLine < 0 || activeLine >= lines.length) return;
      drawLine(activeLine, null);
      activeLine = -1;
    });

    host.addEventListener('mousedown', event => {
      if (event.target.closest && event.target.closest('.live-box')) event.preventDefault();
    });
    host.addEventListener('click', event => {
      const link = event.target.closest && event.target.closest('[data-href]');
      if (link && (event.metaKey || event.ctrlKey)) {
        const url = safeUrl(link.dataset.href);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const box = event.target.closest && event.target.closest('.live-box');
      if (!box || disabled) return;
      const index = Array.prototype.indexOf.call(host.children, box.parentNode);
      const token = tokens[index];
      if (!token || token.type !== 'task') return;
      const at = starts[index] + token.checkbox[0] + 1;
      const selection = readSelection() || [at, at];
      commit(at, at + 1, token.done ? ' ' : 'x', 'toggleTask', selection[1]);
    });

    // ---- The textarea interface ---------------------------------------

    function setValue(value) {
      text = String(value).replace(/\r\n?/g, '\n');
      lines = text.split('\n');
      rebuildStarts();
      drawAll();
      undoStack.length = 0;
      redoStack.length = 0;
      lastKind = '';
    }

    function selectionRange() {
      const selection = readSelection();
      if (selection) return [Math.min(selection[0], selection[1]), Math.max(selection[0], selection[1])];
      return [text.length, text.length];
    }

    Object.defineProperties(host, {
      value: { configurable: true, get: () => text, set: setValue },
      selectionStart: {
        configurable: true,
        get: () => selectionRange()[0],
        set(value) { const [, end] = selectionRange(); writeSelection(value, Math.max(value, end)); }
      },
      selectionEnd: {
        configurable: true,
        get: () => selectionRange()[1],
        set(value) { const [start] = selectionRange(); writeSelection(Math.min(start, value), value); }
      },
      disabled: {
        configurable: true,
        get: () => disabled,
        set(value) {
          disabled = Boolean(value);
          host.contentEditable = disabled ? 'false' : (host.contentEditable === 'false' ? 'plaintext-only' : host.contentEditable);
          if (!disabled && host.contentEditable !== 'plaintext-only') host.contentEditable = 'true';
          host.setAttribute('aria-disabled', String(disabled));
          for (const box of host.querySelectorAll('.live-box')) box.disabled = disabled;
        }
      },
      setSelectionRange: {
        configurable: true,
        value(start, end) { writeSelection(start, end); syncReveal(); }
      },
      // Like the textarea method, this does not send an `input` event.
      setRangeText: {
        configurable: true,
        value(replacement, start, end, mode = 'preserve') {
          const [from, to] = start === undefined ? selectionRange() : [start, end];
          const before = selectionRange();
          remember('setRangeText');
          applyEdit(from, to, replacement);
          let caret = before;
          if (mode === 'select') caret = [from, from + replacement.length];
          else if (mode === 'end') caret = [from + replacement.length, from + replacement.length];
          else if (mode === 'start') caret = [from, from];
          writeSelection(Math.min(caret[0], text.length), Math.min(caret[1], text.length));
          syncReveal();
        }
      }
    });

    setValue('');
    return host;
  }

  root.LiveView = { create };
})(typeof window !== 'undefined' ? window : module.exports);
