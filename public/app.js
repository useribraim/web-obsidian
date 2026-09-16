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
    task.value = '';
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadEntries().catch(error => message(error.message, true));
});
setInterval(() => {
  if (document.visibilityState === 'visible') loadEntries().catch(() => {});
}, REFRESH_INTERVAL);
loadEntries().catch(error => message(error.message, true));
