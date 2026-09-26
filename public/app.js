const content = document.querySelector('#content');
const preview = document.querySelector('#preview');
const editor = document.querySelector('#editor');
const list = document.querySelector('#notes');
const status = document.querySelector('#status');
const save = document.querySelector('#save');
const newButton = document.querySelector('#new');
const trashButton = document.querySelector('#trash');
const deleteButton = document.querySelector('#delete');
const restoreButton = document.querySelector('#restore');
const purgeButton = document.querySelector('#purge');
const bold = document.querySelector('#bold');
const italic = document.querySelector('#italic');
const viewButtons = [...document.querySelectorAll('.view-option')];
const spellcheck = document.querySelector('#spellcheck');
const compactMode = document.querySelector('#compact-mode');
const size = document.querySelector('#size');
const logout = document.querySelector('#logout');
const imageFile = document.querySelector('#image-file');
const imageButton = document.createElement('button');
imageButton.id = 'add-image';
imageButton.className = 'tool';
imageButton.textContent = 'Image';
imageButton.title = 'Upload an image, paste a screenshot, or drop an image into your note';
document.querySelector('.toolbar').insertBefore(imageButton, deleteButton);
let insertingImage = false;
const AUTOSAVE_DELAY = 2500;
let current = null;
let notes = [];
let dirty = false;
let busy = false;
let blocked = false;
let mode = 'active';
let timer = null;
let savingPromise = null;
let blockedMessage = '';
let renaming = false;
let lastClick = { id: null, time: 0 };
let view = window.matchMedia('(max-width: 600px)').matches ? 'edit' : 'split';

logout.onclick = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
};

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function api(path, options) {
  const response = await fetch('/api/notes' + path, options);
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(result.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function safeUrl(href) {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : '#';
}
function renderImage(alt, src) {
  const url = escapeHtml(safeUrl(src));
  const label = escapeHtml(alt);
  return '<button type="button" class="note-image" aria-label="Enlarge image' + (alt ? ': ' + label : '') + '"><img src="' + url + '" alt="' + label + '" loading="lazy"></button>';
}
// Inline spans: code, images, links, emphasis and strikethrough. Input is a
// single line of raw Markdown; HTML is escaped before anything else so note
// content can never inject markup.
function renderInline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (match, code) => {
    codes.push('<code>' + code + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) => {
    // Already escaped above; keep image markup out of the emphasis parser.
    codes.push('<button type="button" class="note-image" aria-label="Enlarge image"><img src="' + safeUrl(src) + '" alt="' + alt + '" loading="lazy"></button>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) =>
    '<a href="' + safeUrl(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (match, index) => codes[Number(index)]);
}
// A list item that starts with [ ] or [x] is a task. Tasks are numbered in
// document order so a click in the preview can find its source line.
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+.*|)$/;
let taskCount = 0;
function renderItem(item) {
  const task = /^\[([ xX])\](?:\s+(.*)|)$/.exec(item);
  if (!task) return '<li>' + renderInline(item);
  const done = task[1] !== ' ';
  const index = taskCount;
  taskCount += 1;
  return '<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" data-task="' + index + '"' +
    (done ? ' checked' : '') + (content.disabled ? ' disabled' : '') + '> ' + renderInline(task[2] || '');
}
// A run of list lines. Deeper indentation (a tab, or two spaces) opens a
// nested list inside the item above it.
function renderList(lines) {
  let html = '';
  const open = [];
  for (const line of lines) {
    const parts = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const depth = parts[1].replace(/\t/g, '  ').length;
    const tag = /^\d/.test(parts[2]) ? 'ol' : 'ul';
    while (open.length && depth < open[open.length - 1].depth) html += '</li></' + open.pop().tag + '>';
    if (open.length && depth === open[open.length - 1].depth && tag !== open[open.length - 1].tag) html += '</li></' + open.pop().tag + '>';
    if (!open.length || depth > open[open.length - 1].depth) {
      html += '<' + tag + '>';
      open.push({ depth, tag });
    } else html += '</li>';
    html += renderItem(parts[3]);
  }
  while (open.length) html += '</li></' + open.pop().tag + '>';
  return html;
}
// Block-level Markdown. A line-based scan keeps headings, lists, quotes and
// fenced code from interfering with one another.
function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const isHeading = line => /^#{1,6}\s+/.test(line);
  const isList = line => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  const imageLine = line => /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const image = imageLine(line);
    if (image) {
      html += '<figure>' + renderImage(image[1], image[2]) + (image[1] ? '<figcaption>' + escapeHtml(image[1]) + '</figcaption>' : '') + '</figure>';
      i += 1;
      continue;
    }
    if (/^```\w*\s*$/.test(line.trim())) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      i += 1;
      html += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += '<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>';
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i += 1; continue; }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      html += '<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>';
      continue;
    }
    if (isList(line)) {
      const items = [];
      while (i < lines.length && isList(lines[i])) { items.push(lines[i]); i += 1; }
      html += renderList(items);
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !isHeading(lines[i]) && !isList(lines[i]) && !imageLine(lines[i]) &&
           !/^\s*>/.test(lines[i]) && !/^```\w*\s*$/.test(lines[i].trim())) {
      paragraph.push(renderInline(lines[i]));
      i += 1;
    }
    html += '<p>' + paragraph.join('<br>') + '</p>';
  }
  return html;
}
function renderPreview() {
  if (editor.dataset.view === 'edit') return;
  taskCount = 0;
  preview.innerHTML = renderMarkdown(noteText());
  if (compactMode.checked) foldEarlierWeeks();
}
// Compact mode folds the day headings ("### 9/11") of every earlier week into
// one closed line per week, so only the current week stays open. Headings
// carry no year; a date more than six months ahead belongs to last year.
const DAY_HEADING = /^(\d{1,2})\/(\d{1,2})(?!\d)/;
const openWeeks = new Set();
function dayDate(text) {
  const match = DAY_HEADING.exec(text.trim());
  if (!match) return null;
  const today = new Date();
  const month = Number(match[1]) - 1;
  const date = new Date(today.getFullYear(), month, Number(match[2]));
  if (date.getMonth() !== month) return null;
  if (date - today > 183 * 86400000) date.setFullYear(date.getFullYear() - 1);
  return date;
}
function foldEarlierWeeks() {
  const thisWeek = startOfWeek(new Date()).getTime();
  const groups = [];
  let group = null;
  for (const node of [...preview.children]) {
    const date = /^H[1-6]$/.test(node.tagName) ? dayDate(node.textContent) : null;
    if (date) {
      const week = startOfWeek(date).getTime();
      if (week >= thisWeek) group = null;
      else if (!group || group.week !== week) {
        const details = document.createElement('details');
        details.className = 'week-fold';
        details.dataset.week = week;
        details.open = openWeeks.has(week);
        details.append(document.createElement('summary'));
        node.before(details);
        group = { week, details, days: 0 };
        groups.push(group);
      }
      if (group) group.days += 1;
    }
    if (group) group.details.append(node);
  }
  for (const { week, details, days } of groups) {
    const open = details.querySelectorAll('li.task:not(.done)').length;
    details.firstChild.textContent = 'Week of ' +
      new Date(week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
      ' · ' + days + (days === 1 ? ' day' : ' days') +
      (open ? ' · ' + open + (open === 1 ? ' open task' : ' open tasks') : '');
  }
}
preview.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.classList?.contains('week-fold')) return;
  const week = Number(details.dataset.week);
  if (details.open) openWeeks.add(week); else openWeeks.delete(week);
}, true);
// A textarea cannot fold, so compact mode keeps the earlier weeks out of it.
// They wait in foldedSource, and noteText() joins them back for the preview
// and for every save, so the stored note never loses them.
let foldedSource = '';
function noteText() { return foldedSource + content.value; }
function currentWeekStart(text) {
  const thisWeek = startOfWeek(new Date()).getTime();
  let offset = 0;
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const date = heading && dayDate(heading[1]);
    if (date && startOfWeek(date).getTime() >= thisWeek) return offset;
    offset += line.length + 1;
  }
  return -1;
}
function setNoteText(text) {
  const split = compactMode.checked ? currentWeekStart(text) : -1;
  foldedSource = split > 0 ? text.slice(0, split) : '';
  const shown = text.slice(foldedSource.length);
  if (content.value !== shown) content.value = shown;
}
// Offsets of every task line, in the order the preview numbers them.
function taskLineOffsets(source) {
  const offsets = [];
  let offset = 0;
  let fenced = false;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (fenced) { if (/^```\s*$/.test(trimmed)) fenced = false; }
    else if (/^```\w*\s*$/.test(trimmed)) fenced = true;
    else if (TASK.test(line.replace(/^(\s*>\s?)+/, ''))) offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}
function toggleTaskLine(line) {
  return line.replace(/\[([ xX])\]/, (match, state) => state === ' ' ? '[x]' : '[ ]');
}
// A click on a preview check box flips the matching source line without
// moving the editor's focus or scroll position.
preview.addEventListener('change', event => {
  const box = event.target;
  if (!box.matches('input[data-task]') || content.disabled || mode !== 'active') return;
  const text = noteText();
  const offset = taskLineOffsets(text)[Number(box.dataset.task)];
  if (offset === undefined) { renderPreview(); return; }
  const end = text.indexOf('\n', offset);
  const lineEnd = end === -1 ? text.length : end;
  const line = toggleTaskLine(text.slice(offset, lineEnd));
  // A task in a folded week lives outside the textarea.
  if (offset < foldedSource.length) foldedSource = foldedSource.slice(0, offset) + line + foldedSource.slice(lineEnd);
  else content.setRangeText(line, offset - foldedSource.length, lineEnd - foldedSource.length, 'preserve');
  content.dispatchEvent(new Event('input', { bubbles: true }));
});
// ⌘L: turn the selected lines into tasks, or flip tasks between done and
// not done. A plain line becomes "- [ ] line"; a list item keeps its marker.
function toggleTasks() {
  if (content.disabled || busy || mode !== 'active') return;
  const value = content.value;
  const start = value.lastIndexOf('\n', content.selectionStart - 1) + 1;
  const stop = value.indexOf('\n', content.selectionEnd);
  const end = stop === -1 ? value.length : stop;
  const lines = value.slice(start, end).split('\n');
  const states = lines.map(line => { const task = TASK.exec(line); return task ? task[2] !== ' ' : null; });
  const allTasks = states.every(state => state !== null);
  const allDone = allTasks && states.every(Boolean);
  const changed = lines.map((line, index) => {
    if (states[index] !== null) {
      if (!allTasks) return line;
      return allDone ? line.replace(/\[[xX]\]/, '[ ]') : line.replace(/\[ \]/, '[x]');
    }
    const list = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(line);
    if (list) return list[1] + '[ ] ' + list[2];
    const indent = /^\s*/.exec(line)[0];
    return indent + '- [ ] ' + line.slice(indent.length);
  });
  const text = changed.join('\n');
  const single = lines.length === 1 && content.selectionStart === content.selectionEnd;
  const caret = content.selectionStart + (changed[0].length - lines[0].length);
  replaceSelection(text, start, end);
  if (single) content.setSelectionRange(Math.max(start, caret), Math.max(start, caret));
  else content.setSelectionRange(start, start + text.length);
}
function replaceSelection(text, start, end) {
  content.focus();
  content.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch {}
  if (!ok) {
    content.setRangeText(text, start, end, 'end');
    content.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function wrapSelection(marker) {
  if (content.disabled || busy) return;
  const start = content.selectionStart;
  const end = content.selectionEnd;
  const value = content.value;
  const selected = value.slice(start, end);
  const len = marker.length;
  if (selected.length === 0) {
    const open = value.lastIndexOf(marker, start - 1);
    const close = value.indexOf(marker, start);
    if (open !== -1 && close !== -1 && open !== close && open + len <= start && start <= close) {
      if (len === 1 && (value[open - 1] === '*' || value[close + len] === '*')) {
        const spanStart = open - 1;
        const spanEnd = close + len + 1;
        replaceSelection('*' + value.slice(spanStart, spanEnd) + '*', spanStart, spanEnd);
        content.setSelectionRange(start + 1, start + 1);
      } else {
        const inner = value.slice(open + len, close);
        replaceSelection(inner, open, close + len);
        content.setSelectionRange(start - len, start - len);
      }
      return;
    }
  }
  const wrapped = selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)
    && !(len === 1 && selected.startsWith('**') && selected.endsWith('**'));
  if (wrapped) {
    const inner = selected.slice(len, selected.length - len);
    replaceSelection(inner, start, end);
    content.setSelectionRange(start, start + inner.length);
    return;
  }
  const insideBold = len === 1 && value.slice(start - 2, start) === '**' && value.slice(end, end + 2) === '**';
  if (!insideBold && start >= len && value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
    const inner = value.slice(start, end);
    replaceSelection(inner, start - len, end + len);
    content.setSelectionRange(start - len, end - len);
    return;
  }
  replaceSelection(marker + selected + marker, start, end);
  content.setSelectionRange(start + len, end + len);
}
function updateControls() {
  const trashed = Boolean(current?.deleted_at);
  content.disabled = busy || trashed || (mode === 'trash' && !current);
  save.disabled = busy;
  save.hidden = mode === 'trash' || trashed;
  deleteButton.hidden = mode === 'trash';
  deleteButton.disabled = busy;
  restoreButton.hidden = !trashed;
  restoreButton.disabled = busy;
  purgeButton.hidden = !trashed;
  purgeButton.disabled = busy;
  newButton.hidden = mode === 'trash';
  newButton.disabled = busy;
  const readOnly = mode === 'trash' || trashed;
  bold.hidden = readOnly;
  imageButton.hidden = readOnly;
  imageButton.disabled = busy;
  italic.hidden = readOnly;
  bold.disabled = busy;
  italic.disabled = busy;
  trashButton.textContent = mode === 'trash' ? 'Back' : 'Trash';
  trashButton.title = mode === 'trash' ? 'Back to notes' : 'Trash';
}
function render() {
  if (renaming) return;
  list.replaceChildren();
  for (const note of notes) {
    const button = document.createElement('button');
    button.className = 'note' + (note.id === current?.id ? ' active' : '');
    button.dataset.id = note.id;
    button.textContent = note.title;
    button.title = mode === 'active' ? note.title + ' — double-click to rename' : note.title;
    button.onclick = () => {
      const now = Date.now();
      if (lastClick.id === note.id && now - lastClick.time < 350) {
        lastClick = { id: null, time: 0 };
        if (mode === 'active') startRename(note.id);
        return;
      }
      lastClick = { id: note.id, time: now };
      openNote(note.id);
    };
    list.append(button);
  }
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = mode === 'trash' ? 'Trash is empty.' : 'Your first page starts here.';
    list.append(empty);
  }
}
async function startRename(id) {
  renaming = true;
  while (busy) await new Promise(resolve => setTimeout(resolve, 50));
  const button = [...list.querySelectorAll('.note')].find(item => item.dataset.id === id);
  const note = notes.find(item => item.id === id);
  if (!button || !note || mode !== 'active') { renaming = false; return; }
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = note.title;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Rename note');
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async keep => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.replaceWith(button);
    renaming = false;
    render();
    if (keep && value && value !== note.title) await renameNote(id, value);
  };
  input.onblur = () => finish(true);
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  };
}
async function renameNote(id, newTitle) {
  try {
    const note = await api('/' + id);
    const saved = await api('/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, content: note.content, version: note.version }),
    });
    notes = notes.map(item => item.id === saved.id ? { ...item, title: saved.title } : item);
    if (current?.id === saved.id) current = { ...current, title: saved.title, version: saved.version };
    message('Renamed');
    render();
  } catch (error) { message(error.message, true); }
}
function setBusy(value) {
  busy = value;
  updateControls();
  render();
}
function resetDraft() {
  showReport(false);
  clearTimeout(timer);
  current = null;
  foldedSource = '';
  content.value = '';
  renderPreview();
  dirty = false;
  blocked = false;
  blockedMessage = '';
  updateControls();
  render();
}
function show(note) {
  showReport(false);
  current = note;
  setNoteText(note.content);
  renderPreview();
  dirty = false;
  blocked = false;
  blockedMessage = '';
  updateControls();
  render();
}
function schedule() {
  clearTimeout(timer);
  if (blocked || mode === 'trash') return;
  timer = setTimeout(saveNote, AUTOSAVE_DELAY);
}
async function flush() {
  clearTimeout(timer);
  if (savingPromise) { try { await savingPromise; } catch {} }
  if (!dirty) return true;
  if (await saveNote()) return true;
  return confirm('Your latest changes could not be saved. Leave and discard them?');
}
async function saveNote() {
  clearTimeout(timer);
  if (mode === 'trash') return false;
  while (savingPromise) { try { await savingPromise; } catch {} }
  if (!dirty) { if (current) message('Saved'); return true; }
  if (!current && !noteText()) {
    dirty = false;
    message('New note');
    return true;
  }
  savingPromise = doSave();
  try {
    await savingPromise;
    blocked = false;
    blockedMessage = '';
    return true;
  } catch (error) {
    message(error.message, true);
    if (error.status === 409 || error.status === 410) {
      blocked = true;
      blockedMessage = error.message;
      if (error.status === 410 && current) {
        notes = notes.filter(item => item.id !== current.id);
        render();
      }
    }
    return false;
  } finally {
    savingPromise = null;
  }
}
async function doSave() {
  message('Saving…');
  const sentTitle = current?.title || 'Untitled note';
  const sentContent = noteText();
  const saved = await api(current ? '/' + current.id : '', {
    method: current ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: sentTitle, content: sentContent, version: current?.version }),
  });
  current = saved;
  notes = [saved, ...notes.filter(item => item.id !== saved.id)];
  if (noteText() === sentContent) {
    if (saved.content !== sentContent) setNoteText(saved.content);
    dirty = false;
    message('Saved');
  } else {
    dirty = true;
    message('Unsaved');
    schedule();
  }
  updateControls();
  render();
}
async function openNote(id) {
  if (busy) return;
  if (!(await flush())) return;
  setBusy(true);
  message('Loading…');
  try {
    show(await api('/' + id));
    message(current.deleted_at ? 'In trash — restore it to edit.' : 'Saved');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}
newButton.onclick = async () => {
  if (busy || mode === 'trash') return;
  if (!(await flush())) return;
  resetDraft();
  message('New note');
  content.focus();
};
trashButton.onclick = async () => {
  if (busy) return;
  if (mode === 'active' && !(await flush())) return;
  mode = mode === 'active' ? 'trash' : 'active';
  resetDraft();
  setBusy(true);
  try {
    notes = await api(mode === 'trash' ? '?trash=1' : '');
    message(mode === 'trash' ? (notes.length ? 'Trash — select a note to restore.' : 'Trash is empty.') : 'Notes');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
  if (mode === 'active') {
    if (notes.length) await openNote(notes[0].id);
    else { message('New note'); content.focus(); }
  }
};
deleteButton.onclick = async () => {
  if (busy || mode === 'trash') return;
  if (!current) {
    if (noteText() && !confirm('Discard this draft?')) return;
    resetDraft();
    message('New note');
    content.focus();
    return;
  }
  if (!confirm('Move "' + current.title + '" to trash?')) return;
  clearTimeout(timer);
  setBusy(true);
  let moveOn = false;
  try {
    await api('/' + current.id, { method: 'DELETE' });
    notes = notes.filter(item => item.id !== current.id);
    current = null;
    dirty = false;
    message('Moved to trash');
    moveOn = true;
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
  if (moveOn) {
    if (notes.length) await openNote(notes[0].id);
    else { resetDraft(); message('Moved to trash'); }
  }
};
restoreButton.onclick = async () => {
  if (busy || !current?.deleted_at) return;
  const id = current.id;
  setBusy(true);
  try {
    const note = await api('/' + id + '/restore', { method: 'POST' });
    mode = 'active';
    notes = await api('');
    show(note);
    message('Restored');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
};
purgeButton.onclick = async () => {
  if (busy || !current?.deleted_at) return;
  if (!confirm('Delete "' + current.title + '" forever? This cannot be undone.')) return;
  setBusy(true);
  let moveOn = false;
  try {
    await api('/' + current.id + '?forever=1', { method: 'DELETE' });
    notes = notes.filter(item => item.id !== current.id);
    current = null;
    dirty = false;
    message('Deleted forever');
    moveOn = true;
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
  if (moveOn) {
    if (notes.length) await openNote(notes[0].id);
    else { resetDraft(); message('Trash is empty.'); }
  }
};
content.addEventListener('input', event => {
  dirty = true;
  renderPreview();
  message(blocked ? blockedMessage : 'Unsaved', blocked);
  schedule();
});
let syncingScroll = false;
content.addEventListener('scroll', () => {
  if (syncingScroll || editor.dataset.view === 'preview') return;
  const from = content.scrollHeight - content.clientHeight;
  const to = preview.scrollHeight - preview.clientHeight;
  if (from <= 0 || to <= 0) return;
  syncingScroll = true;
  preview.scrollTop = (content.scrollTop / from) * to;
  requestAnimationFrame(() => { syncingScroll = false; });
});
let tabMovesFocus = false;
function editorKeydown(event) {
  const content = event.currentTarget;
  if (event.key === 'Escape') { tabMovesFocus = true; return; }
  if (event.key !== 'Tab') { tabMovesFocus = false; return; }
  if (tabMovesFocus || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  if (event.shiftKey) {
    const start = content.selectionStart;
    if (start > 0 && content.selectionEnd === start && content.value[start - 1] === '\t') {
      let ok = false;
      content.setSelectionRange(start - 1, start);
      try { ok = document.execCommand('delete'); } catch {}
      if (!ok) {
        content.setRangeText('', start - 1, start, 'end');
        content.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return;
  }
  replaceSelection('\t', content.selectionStart, content.selectionEnd);
}
content.addEventListener('keydown', editorKeydown);
content.addEventListener('blur', () => { tabMovesFocus = false; });
bold.onclick = () => wrapSelection('**');
italic.onclick = () => wrapSelection('*');
const VIEW_KEY = 'noteView';
try {
  const saved = localStorage.getItem(VIEW_KEY);
  if (saved && ['edit', 'split', 'preview'].includes(saved)) view = saved;
} catch {}
function applyView() {
  editor.dataset.view = view;
  for (const button of viewButtons) button.classList.toggle('active', button.dataset.view === view);
  if (view !== 'edit') renderPreview();
}
for (const button of viewButtons) {
  button.onclick = () => {
    view = button.dataset.view;
    applyView();
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  };
}
applyView();
// Focus mode keeps the note, its preview and the timer, and hides the rest.
// The choice survives a reload, so a work day stays in focus until it is unticked.
const FOCUS_KEY = 'noteFocus';
const focusMode = document.querySelector('#focus-mode');
try { focusMode.checked = localStorage.getItem(FOCUS_KEY) === '1'; } catch {}
function applyFocus() {
  document.body.classList.toggle('focus', focusMode.checked);
  if (focusMode.checked) {
    editor.dataset.view = 'split';
    renderPreview();
  } else {
    applyView();
  }
}
focusMode.addEventListener('change', () => {
  if (focusMode.checked) showReport(false);
  applyFocus();
  try { localStorage.setItem(FOCUS_KEY, focusMode.checked ? '1' : '0'); } catch {}
});
applyFocus();
const COMPACT_KEY = 'noteCompact';
try { compactMode.checked = localStorage.getItem(COMPACT_KEY) === '1'; } catch {}
compactMode.addEventListener('change', () => {
  const folded = foldedSource.length;
  const start = content.selectionStart + folded;
  const end = content.selectionEnd + folded;
  const text = noteText();
  foldedSource = '';
  content.value = '';
  setNoteText(text);
  const shift = foldedSource.length;
  content.setSelectionRange(Math.max(0, start - shift), Math.max(0, end - shift));
  content.scrollTop = 0;
  renderPreview();
  try { localStorage.setItem(COMPACT_KEY, compactMode.checked ? '1' : '0'); } catch {}
});
const SPELL_KEY = 'noteSpellcheck';
try {
  if (localStorage.getItem(SPELL_KEY) === '0') spellcheck.checked = false;
} catch {}
function applySpellcheck() { content.spellcheck = spellcheck.checked; }
spellcheck.addEventListener('change', () => {
  applySpellcheck();
  try { localStorage.setItem(SPELL_KEY, spellcheck.checked ? '1' : '0'); } catch {}
});
applySpellcheck();
save.onclick = saveNote;
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    if (!busy && mode === 'active') saveNote();
  } else if ((key === 'b' || key === 'i') && document.activeElement === content) {
    event.preventDefault();
    if (mode === 'active') wrapSelection(key === 'b' ? '**' : '*');
  } else if (key === 'l' && document.activeElement === content && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    toggleTasks();
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty && mode === 'active') { event.preventDefault(); event.returnValue = ''; }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector('kbd').textContent = 'Ctrl S';
const SIZE_KEY = 'noteSize';
const sizeOptions = document.querySelector('#size-options');
const sizeChoices = [...sizeOptions.querySelectorAll('[data-size]')];
let noteSize = '14';
function applySize() {
  document.documentElement.style.setProperty('--note-size', noteSize + 'px');
  size.textContent = noteSize + ' px ▾';
  size.setAttribute('aria-label', 'Text size: ' + noteSize + ' pixels');
  for (const choice of sizeChoices) choice.setAttribute('aria-pressed', String(choice.dataset.size === noteSize));
}
function showSizeOptions(open, restoreFocus = false) {
  sizeOptions.hidden = !open;
  size.setAttribute('aria-expanded', String(open));
  if (open) sizeChoices.find(choice => choice.dataset.size === noteSize).focus();
  else if (restoreFocus) size.focus();
}
try {
  const saved = localStorage.getItem(SIZE_KEY);
  if (sizeChoices.some(choice => choice.dataset.size === saved)) noteSize = saved;
} catch {}
applySize();
renderPreview();
size.onclick = () => showSizeOptions(sizeOptions.hidden);
for (const choice of sizeChoices) {
  choice.onclick = () => {
    noteSize = choice.dataset.size;
    applySize();
    try { localStorage.setItem(SIZE_KEY, noteSize); } catch {}
    showSizeOptions(false, true);
  };
}
document.addEventListener('click', event => {
  if (!event.target.closest('.size-picker')) showSizeOptions(false);
});
document.querySelector('.size-picker').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sizeOptions.hidden) {
    event.preventDefault();
    showSizeOptions(false, true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    if (sizeOptions.hidden) { showSizeOptions(true); return; }
    const index = sizeChoices.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sizeChoices.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + sizeChoices.length) % sizeChoices.length;
    sizeChoices[next].focus();
  }
});
async function init() {
  setBusy(true);
  try {
    notes = await api('');
    setBusy(false);
    if (notes.length) await openNote(notes[0].id);
    else { message('New note'); content.focus(); }
  } catch (error) { setBusy(false); message(error.message, true); }
}
init();

// Images live separately from note text. Insert links only after upload succeeds.
const MAX_IMAGE_BYTES = 1_500_000;
async function prepareImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  if (file.size > 20_000_000) throw new Error('Choose an image smaller than 20 MB.');
  if (file.size <= MAX_IMAGE_BYTES) return file;
  if (file.type === 'image/gif') throw new Error('Animated GIFs must be smaller than 1.5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', attempt ? .8 : .92));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
      canvas.width = Math.max(1, Math.round(canvas.width * .75));
      canvas.height = Math.max(1, Math.round(canvas.height * .75));
    }
    throw new Error('This image is too large. Try a smaller version.');
  } finally { URL.revokeObjectURL(url); }
}
async function uploadImages(files) {
  if (!files.length || busy || content.disabled || mode !== 'active') return;
  const start = content.selectionStart;
  const end = content.selectionEnd;
  const links = [];
  let failure = '';
  setBusy(true);
  try {
    for (let index = 0; index < files.length; index += 1) {
      message('Uploading image ' + (index + 1) + ' of ' + files.length + '…');
      const image = await prepareImage(files[index]);
      const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Image upload failed. Please try again.');
      const caption = files[index].name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').trim().slice(0, 120);
      links.push('![' + caption + '](' + result.url + ')');
    }
  } catch (error) { failure = error.message || 'Image upload failed. Please try again.'; }
  finally { setBusy(false); }
  if (links.length) {
    const markdown = '\n\n' + links.join('\n\n') + '\n\n';
    if (noteText().length - (end - start) + markdown.length > content.maxLength) {
      message('This note is full. Make room before adding images.', true);
      return;
    }
    insertingImage = true;
    try { replaceSelection(markdown, start, end); }
    finally { insertingImage = false; }
    view = window.matchMedia('(max-width: 600px)').matches ? 'preview' : 'split';
    applyView();
  }
  if (failure) message(failure, true);
}
imageButton.onclick = () => imageFile.click();
imageFile.onchange = () => {
  const files = [...imageFile.files];
  imageFile.value = '';
  uploadImages(files);
};
content.addEventListener('paste', event => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  uploadImages(files);
});
editor.addEventListener('dragover', event => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy || content.disabled ? 'none' : 'copy';
  if (!busy && !content.disabled) editor.classList.add('image-drop');
});
editor.addEventListener('dragleave', event => {
  if (!editor.contains(event.relatedTarget)) editor.classList.remove('image-drop');
});
editor.addEventListener('drop', event => {
  editor.classList.remove('image-drop');
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  event.preventDefault();
  uploadImages(files);
});
// A missed drop should never navigate away from an unsaved note.
for (const type of ['dragover', 'drop']) document.addEventListener(type, event => {
  if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
});
const imageViewer = document.querySelector('#image-viewer');
const enlargedImage = document.querySelector('#enlarged-image');
preview.addEventListener('click', event => {
  const button = event.target.closest('.note-image');
  if (!button) return;
  const image = button.querySelector('img');
  enlargedImage.src = image.src;
  enlargedImage.alt = image.alt;
  document.querySelector('#image-caption').textContent = image.alt;
  imageViewer.showModal();
});
document.querySelector('#close-image').onclick = () => imageViewer.close();
imageViewer.addEventListener('click', event => { if (event.target === imageViewer) imageViewer.close(); });
imageViewer.addEventListener('close', () => enlargedImage.removeAttribute('src'));
preview.addEventListener('error', event => {
  if (event.target.tagName !== 'IMG') return;
  const button = event.target.closest('.note-image');
  if (!button || button.querySelector('.image-error')) return;
  const error = document.createElement('span');
  error.className = 'image-error';
  error.textContent = 'Image unavailable';
  button.append(error);
}, true);

// Time tracker. One entry runs at a time. Entries live in D1, so the clock
// resumes after a reload or on another device. Totals are computed in the
// browser's local time zone; an entry that crosses a day boundary counts
// toward each day for the part that falls inside it.
const task = document.querySelector('#task');
const clock = document.querySelector('#clock');
const toggleTimer = document.querySelector('#toggle-timer');
const reportButton = document.querySelector('#report');
const closeReport = document.querySelector('#close-report');
const reportView = document.querySelector('#report-view');
const weekChart = document.querySelector('#week-chart');
const entriesView = document.querySelector('#entries');
const main = document.querySelector('main');
const sums = {
  today: [document.querySelector('#sum-today'), document.querySelector('#report-today')],
  week: [document.querySelector('#sum-week'), document.querySelector('#report-week')],
  month: [document.querySelector('#sum-month'), document.querySelector('#report-month')],
};

const REFRESH_INTERVAL = 60_000;
const HEARTBEAT_INTERVAL = 5 * 60_000;
let entries = [];
let running = null;
let timerBusy = false;
let editingId = null;
let clockTick = null;

async function timeApi(path, options) {
  const response = await fetch('/api/time' + path, options);
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfWeek(date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Monday
  return day;
}
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function entryEnd(entry, now) { return entry.stopped_at ? Date.parse(entry.stopped_at) : now; }
function overlap(entry, from, to, now) {
  const start = Math.max(Date.parse(entry.started_at), from.getTime());
  const end = Math.min(entryEnd(entry, now), to.getTime());
  return Math.max(0, end - start);
}
function total(from, to, now) {
  return entries.reduce((sum, entry) => sum + overlap(entry, from, to, now), 0);
}
function formatHours(ms) {
  const minutes = Math.floor(ms / 60000);
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
}
function formatClock(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatDay(date) {
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
// Value for a datetime-local input, in local time, to the minute.
function localInputValue(iso) {
  const date = new Date(iso);
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function updateTotals() {
  const now = Date.now();
  const today = startOfDay(new Date());
  const values = {
    today: total(today, addDays(today, 1), now),
    week: total(startOfWeek(new Date()), addDays(startOfWeek(new Date()), 7), now),
    month: total(startOfMonth(new Date()), new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), now),
  };
  for (const key of Object.keys(values)) {
    for (const element of sums[key]) element.textContent = formatHours(values[key]);
  }
}
function updateClock() {
  clock.textContent = running ? formatClock(Date.now() - Date.parse(running.started_at)) : '0:00:00';
  updateTotals();
  if (running && main.dataset.page === 'report') renderRunningDurations();
}
function renderRunningDurations() {
  const element = entriesView.querySelector('[data-id="' + running.id + '"] .entry-duration');
  if (element) element.textContent = formatClock(Date.now() - Date.parse(running.started_at));
}
function applyRunning() {
  running = entries.find(entry => !entry.stopped_at) || null;
  toggleTimer.textContent = running ? 'Stop' : 'Start';
  toggleTimer.classList.toggle('running', Boolean(running));
  toggleTimer.disabled = timerBusy;
  task.disabled = timerBusy;
  if (running) {
    if (document.activeElement !== task) task.value = running.description;
    document.title = 'Notes — ' + (running.description || 'Timer running');
    if (!clockTick) clockTick = setInterval(updateClock, 1000);
  } else {
    document.title = 'Notes';
    clearInterval(clockTick);
    clockTick = null;
  }
  updateClock();
}
async function loadEntries() {
  const since = new Date(Math.min(startOfWeek(new Date()).getTime(), startOfMonth(new Date()).getTime()));
  entries = await timeApi('?since=' + encodeURIComponent(since.toISOString()));
  applyRunning();
  if (main.dataset.page === 'report' && !editingId) renderReport();
}
async function withTimer(action) {
  if (timerBusy) return;
  timerBusy = true;
  applyRunning();
  try { await action(); }
  catch (error) { message(error.message, true); }
  finally { timerBusy = false; applyRunning(); }
}
toggleTimer.onclick = () => withTimer(async () => {
  if (running) {
    const stopped = await timeApi('/' + running.id + '/stop', { method: 'POST' });
    entries = entries.map(entry => entry.id === stopped.id ? stopped : entry);
    task.value = stopped.description;
    message('Timer stopped');
  } else {
    const started = await timeApi('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: task.value.trim() }),
    });
    const now = started.started_at;
    entries = [started, ...entries.map(entry => entry.stopped_at ? entry : { ...entry, stopped_at: now })];
    message('Timer started');
  }
  if (main.dataset.page === 'report') renderReport();
});
task.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !running) { event.preventDefault(); toggleTimer.click(); }
});
// A description typed while the clock runs is saved to the running entry.
task.addEventListener('change', () => {
  if (!running || task.value.trim() === running.description) return;
  const id = running.id;
  const description = task.value.trim();
  timeApi('/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  }).then(saved => {
    entries = entries.map(entry => entry.id === saved.id ? saved : entry);
    applyRunning();
    if (main.dataset.page === 'report') renderReport();
  }).catch(error => message(error.message, true));
});

// Report page: totals, a bar per day of the current week, and the entries of
// the current month grouped by day, newest first.
function renderWeekChart() {
  const now = Date.now();
  const weekStart = startOfWeek(new Date());
  const today = startOfDay(new Date()).getTime();
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const from = addDays(weekStart, offset);
    days.push({ from, ms: total(from, addDays(from, 1), now) });
  }
  const max = Math.max(...days.map(day => day.ms), 1);
  weekChart.replaceChildren();
  for (const day of days) {
    const bar = document.createElement('div');
    bar.className = 'bar' + (day.from.getTime() === today ? ' today' : '');
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = day.ms ? formatHours(day.ms) : '';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.height = Math.round((day.ms / max) * 100) + '%';
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = day.from.toLocaleDateString([], { weekday: 'short' });
    bar.append(value, fill, label);
    bar.title = formatDay(day.from) + ': ' + formatHours(day.ms);
    weekChart.append(bar);
  }
}
function entryRow(entry) {
  const now = Date.now();
  const row = document.createElement('div');
  row.className = 'entry';
  row.dataset.id = entry.id;
  if (editingId === entry.id) {
    row.classList.add('editing');
    row.append(entryForm(entry));
    return row;
  }
  const description = document.createElement('span');
  description.className = 'entry-desc' + (entry.description ? '' : ' empty');
  description.textContent = entry.description || 'No description';
  description.title = entry.description;
  const range = document.createElement('span');
  range.className = 'entry-range';
  range.textContent = formatTime(entry.started_at) + ' – ' + (entry.stopped_at ? formatTime(entry.stopped_at) : 'now');
  const duration = document.createElement('span');
  duration.className = 'entry-duration';
  duration.textContent = entry.stopped_at ? formatHours(entryEnd(entry, now) - Date.parse(entry.started_at)) : formatClock(now - Date.parse(entry.started_at));
  const actions = document.createElement('span');
  actions.className = 'entry-actions';
  if (entry.stopped_at) {
    const edit = document.createElement('button');
    edit.textContent = 'Edit';
    edit.onclick = () => { editingId = entry.id; renderReport(); };
    actions.append(edit);
  }
  const remove = document.createElement('button');
  remove.className = 'danger';
  remove.textContent = 'Delete';
  remove.onclick = () => deleteEntry(entry);
  actions.append(remove);
  row.append(description, range, duration, actions);
  return row;
}
function entryForm(entry) {
  const form = document.createElement('form');
  form.className = 'entry-form';
  const description = document.createElement('input');
  description.type = 'text';
  description.value = entry.description;
  description.maxLength = 200;
  description.placeholder = 'Description';
  description.setAttribute('aria-label', 'Description');
  const started = document.createElement('input');
  started.type = 'datetime-local';
  started.value = localInputValue(entry.started_at);
  started.required = true;
  started.setAttribute('aria-label', 'Start time');
  const stopped = document.createElement('input');
  stopped.type = 'datetime-local';
  stopped.value = localInputValue(entry.stopped_at);
  stopped.required = true;
  stopped.setAttribute('aria-label', 'Stop time');
  const actions = document.createElement('span');
  actions.className = 'entry-form-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'tool';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { editingId = null; renderReport(); };
  const saveEntry = document.createElement('button');
  saveEntry.type = 'submit';
  saveEntry.className = 'tool';
  saveEntry.textContent = 'Save';
  actions.append(cancel, saveEntry);
  form.append(description, started, stopped, actions);
  form.onsubmit = event => {
    event.preventDefault();
    const startedAt = new Date(started.value);
    const stoppedAt = new Date(stopped.value);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) { message('Give the entry a valid start and stop time.', true); return; }
    if (stoppedAt < startedAt) { message('The stop time must come after the start time.', true); return; }
    withTimer(async () => {
      const saved = await timeApi('/' + entry.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.value.trim(), started_at: startedAt.toISOString(), stopped_at: stoppedAt.toISOString() }),
      });
      entries = entries.map(item => item.id === saved.id ? saved : item);
      editingId = null;
      message('Entry saved');
      renderReport();
    });
  };
  description.focus();
  return form;
}
async function deleteEntry(entry) {
  const label = entry.description ? '"' + entry.description + '"' : 'this entry';
  if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
  await withTimer(async () => {
    await timeApi('/' + entry.id, { method: 'DELETE' });
    entries = entries.filter(item => item.id !== entry.id);
    if (editingId === entry.id) editingId = null;
    message('Entry deleted');
    renderReport();
  });
}
function renderReport() {
  updateTotals();
  renderWeekChart();
  const now = Date.now();
  const monthStart = startOfMonth(new Date());
  const shown = entries
    .filter(entry => entryEnd(entry, now) >= monthStart.getTime())
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  entriesView.replaceChildren();
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No time tracked this month. Type a task and press Start.';
    entriesView.append(empty);
    return;
  }
  const groups = new Map();
  for (const entry of shown) {
    const key = startOfDay(new Date(entry.started_at)).getTime();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [key, group] of groups) {
    const day = new Date(key);
    const section = document.createElement('section');
    section.className = 'day';
    const head = document.createElement('div');
    head.className = 'day-head';
    const title = document.createElement('span');
    title.textContent = formatDay(day);
    const sum = document.createElement('b');
    sum.textContent = formatHours(total(day, addDays(day, 1), now));
    head.append(title, sum);
    section.append(head, ...group.map(entryRow));
    entriesView.append(section);
  }
}
function showReport(open) {
  main.dataset.page = open ? 'report' : 'notes';
  reportView.hidden = !open;
  if (open) renderReport();
  else editingId = null;
}
reportButton.onclick = () => showReport(main.dataset.page !== 'report');
closeReport.onclick = () => showReport(false);
// Escape leaves the report, or an entry form inside it, and returns to the note.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || main.dataset.page !== 'report' || event.isComposing) return;
  event.preventDefault();
  if (editingId) { editingId = null; renderReport(); return; }
  showReport(false);
  reportButton.focus();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadEntries().catch(error => message(error.message, true));
});
setInterval(() => {
  if (document.visibilityState === 'visible') loadEntries().catch(() => {});
}, REFRESH_INTERVAL);
// While the clock runs, tell the server the page is awake. A laptop that
// sleeps sends nothing, and the server then stops the entry at the last
// heartbeat, so the sleep is not counted as work.
async function heartbeat() {
  if (!running) return;
  const updated = await timeApi('/' + running.id + '/heartbeat', { method: 'POST' });
  if (updated.stopped_at) await loadEntries();
}
setInterval(() => { heartbeat().catch(() => {}); }, HEARTBEAT_INTERVAL);
loadEntries().catch(error => message(error.message, true));
