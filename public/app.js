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
const size = document.querySelector('#size');
const logout = document.querySelector('#logout');

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
// Inline spans: code, images, links, emphasis and strikethrough. Input is a
// single line of raw Markdown; HTML is escaped before anything else so note
// content can never inject markup.
function renderInline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (match, code) => {
    codes.push(code);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) =>
    '<img src="' + safeUrl(src) + '" alt="' + alt + '" loading="lazy">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) =>
    '<a href="' + safeUrl(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (match, index) => '<code>' + codes[Number(index)] + '</code>');
}
// Block-level Markdown. A line-based scan keeps headings, lists, quotes and
// fenced code from interfering with one another.
function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const isHeading = line => /^#{1,6}\s+/.test(line);
  const isList = line => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
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
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items = [];
      while (i < lines.length && marker.test(lines[i])) { items.push(renderInline(lines[i].replace(marker, ''))); i += 1; }
      const tag = ordered ? 'ol' : 'ul';
      html += '<' + tag + '>' + items.map(item => '<li>' + item + '</li>').join('') + '</' + tag + '>';
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !isHeading(lines[i]) && !isList(lines[i]) &&
           !/^\s*>/.test(lines[i]) && !/^```\w*\s*$/.test(lines[i].trim())) {
      paragraph.push(renderInline(lines[i]));
      i += 1;
    }
    html += '<p>' + paragraph.join('<br>') + '</p>';
  }
  return html;
}
function renderPreview() {
  if (view === 'edit') return;
  preview.innerHTML = renderMarkdown(content.value);
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
  clearTimeout(timer);
  current = null;
  content.value = '';
  renderPreview();
  dirty = false;
  blocked = false;
  blockedMessage = '';
  updateControls();
  render();
}
function show(note) {
  current = note;
  content.value = note.content;
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
  if (!current && !content.value) {
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
  const sentContent = content.value;
  const saved = await api(current ? '/' + current.id : '', {
    method: current ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: sentTitle, content: sentContent, version: current?.version }),
  });
  current = saved;
  notes = [saved, ...notes.filter(item => item.id !== saved.id)];
  if (content.value === sentContent) {
    content.value = saved.content;
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
    if (content.value && !confirm('Discard this draft?')) return;
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
content.addEventListener('input', () => {
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
content.addEventListener('keydown', event => {
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
});
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
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty && mode === 'active') { event.preventDefault(); event.returnValue = ''; }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector('kbd').textContent = 'Ctrl S';
const SIZE_KEY = 'noteSize';
function applySize() {
  document.documentElement.style.setProperty('--note-size', size.value + 'px');
}
try {
  const saved = localStorage.getItem(SIZE_KEY);
  if (saved && size.querySelector('option[value="' + saved + '"]')) size.value = saved;
} catch {}
applySize();
renderPreview();
size.addEventListener('change', () => {
  applySize();
  try { localStorage.setItem(SIZE_KEY, size.value); } catch {}
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
