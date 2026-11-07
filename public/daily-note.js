// The daily note floats above the page and stays open across reloads.
// It lists the tasks that repeat every day. Ticks belong to one day and clear
// on the next. The list is kept on the server, so every device sees it.
(() => {
  const OPEN_KEY = 'dailyNoteOpen';
  const POSITION_KEY = 'dailyNotePosition';
  const panel = document.querySelector('#daily-note');
  const head = panel.querySelector('.daily-head');
  const listView = panel.querySelector('#daily-items');
  const count = panel.querySelector('#daily-count');
  const status = panel.querySelector('#daily-status');
  const form = panel.querySelector('#daily-form');
  const input = panel.querySelector('#daily-input');
  const openButton = document.querySelector('#daily-open');
  let list = { items: [], done: [], done_on: '' };
  let loaded = false;
  let edits = 0;
  let saving = Promise.resolve();
  let returnFocus = null;

  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // Ticks from an earlier day do not count today.
  function doneToday() { return list.done_on === today() ? list.done : []; }

  function render() {
    const done = new Set(doneToday());
    listView.replaceChildren();
    for (const item of list.items) {
      const row = document.createElement('li');
      row.className = 'daily-item' + (done.has(item.id) ? ' done' : '');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = done.has(item.id);
      box.dataset.id = item.id;
      const text = document.createElement('span');
      text.textContent = item.text;
      label.append(box, text);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'daily-remove';
      remove.dataset.id = item.id;
      remove.setAttribute('aria-label', 'Remove ' + item.text);
      remove.title = 'Remove from the daily list';
      remove.textContent = '×';
      row.append(label, remove);
      listView.append(row);
    }
    if (!list.items.length && loaded) {
      const empty = document.createElement('li');
      empty.className = 'daily-empty';
      empty.textContent = 'Add the things you do every day.';
      listView.append(empty);
    }
    count.textContent = list.items.length ? `${done.size}/${list.items.length}` : '';
    panel.classList.toggle('complete', list.items.length > 0 && done.size === list.items.length);
  }

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  // A load that started before a local change must not overwrite that change.
  async function load() {
    const startedAt = edits;
    try {
      await saving;
      const response = await fetch('/api/daily');
      if (!response.ok) throw new Error();
      const fetched = await response.json();
      if (edits !== startedAt) return;
      list = fetched;
      loaded = true;
      showStatus('');
    } catch {
      showStatus('Could not load the daily list.');
    }
    render();
  }

  // Saves run one after another, so the last change always wins.
  function save() {
    const body = JSON.stringify(list);
    saving = saving.then(async () => {
      try {
        const response = await fetch('/api/daily', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error);
        showStatus('');
      } catch (error) {
        showStatus(error.message || 'Could not save the daily list.');
      }
    });
  }

  function change(update) {
    edits += 1;
    if (list.done_on !== today()) list = { ...list, done: [], done_on: today() };
    update();
    render();
    save();
  }

  listView.addEventListener('change', event => {
    const id = event.target.dataset.id;
    if (!id) return;
    change(() => {
      list.done = event.target.checked ? [...new Set([...list.done, id])] : list.done.filter(other => other !== id);
    });
  });
  listView.addEventListener('click', event => {
    const button = event.target.closest('.daily-remove');
    if (!button) return;
    const index = list.items.findIndex(item => item.id === button.dataset.id);
    change(() => {
      list.items = list.items.filter(item => item.id !== button.dataset.id);
      list.done = list.done.filter(id => id !== button.dataset.id);
    });
    const rows = listView.querySelectorAll('.daily-remove');
    (rows[Math.min(index, rows.length - 1)] || input).focus();
  });
  // A task added before the list arrives would replace the stored list, so wait for it.
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (!loaded) await load();
    if (!loaded) { if (!input.value) input.value = text; return; }
    if (list.items.length >= 50) { showStatus('The daily list holds up to 50 tasks.'); return; }
    change(() => { list.items = [...list.items, { id: newId(), text }]; });
  });

  // The position is kept inside the window, so a smaller window never hides the note.
  function place(left, top) {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const x = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
    const y = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    return { left: x, top: y };
  }
  function restorePosition() {
    let saved = null;
    try { saved = JSON.parse(read(POSITION_KEY)); } catch {}
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(saved.left, saved.top);
    else place(window.innerWidth - panel.offsetWidth - 28, 80);
  }
  head.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const start = panel.getBoundingClientRect();
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    head.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
    const move = moveEvent => place(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    const stop = () => {
      head.removeEventListener('pointermove', move);
      panel.classList.remove('dragging');
      write(POSITION_KEY, JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }));
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('lostpointercapture', stop, { once: true });
  });
  window.addEventListener('resize', () => { if (!panel.hidden) place(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0); });

  function setOpen(open, focus = true) {
    panel.hidden = !open;
    openButton.setAttribute('aria-expanded', String(open));
    write(OPEN_KEY, open ? '1' : '0');
    if (open) {
      restorePosition();
      load();
      if (focus) { returnFocus = document.activeElement; input.focus(); }
    } else if (focus && panel.contains(document.activeElement)) {
      const back = returnFocus && returnFocus !== document.body && document.contains(returnFocus) ? returnFocus : document.querySelector('#content');
      back.focus();
    }
  }
  window.toggleDailyNote = () => setOpen(panel.hidden);

  openButton.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('#daily-close').addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  });
  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'j') return;
    event.preventDefault();
    if (panel.hidden) setOpen(true);
    else if (!panel.contains(document.activeElement)) input.focus();
    else setOpen(false);
  });
  // Another device may have changed the list, and the day may have turned.
  window.addEventListener('focus', () => { if (!panel.hidden) load(); });
  setInterval(() => { if (!panel.hidden && list.done_on && list.done_on !== today()) render(); }, 60_000);

  if (read(OPEN_KEY) === '1') setOpen(true, false);
})();
