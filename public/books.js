// Books: a library of PDF and EPUB files, and a reader for each. The files live
// in R2; the server keeps the title and the reading position. A PDF opens in
// the browser's own viewer. An EPUB is drawn by epub.js, loaded on first use.
(() => {
  const view = document.querySelector('#books-view');
  const openButton = document.querySelector('#books-open');
  const closeButton = document.querySelector('#books-close');
  const uploadButton = document.querySelector('#books-upload');
  const fileInput = document.querySelector('#book-file');
  const shelf = document.querySelector('#books-list');
  const note = document.querySelector('#books-note');
  const library = document.querySelector('#library');
  const reader = document.querySelector('#reader');
  const stage = document.querySelector('#reader-stage');
  const readerTitle = document.querySelector('#reader-title');
  const toc = document.querySelector('#reader-toc');
  const smaller = document.querySelector('#reader-smaller');
  const larger = document.querySelector('#reader-larger');
  const themeButton = document.querySelector('#reader-theme');
  const pageInput = document.querySelector('#reader-page');
  const prevButton = document.querySelector('#reader-prev');
  const nextButton = document.querySelector('#reader-next');
  const progressLabel = document.querySelector('#reader-progress');
  const backButton = document.querySelector('#reader-back');

  const MAX_BOOK_BYTES = 95_000_000;
  const THEME_KEY = 'bookTheme';
  const FONT_KEY = 'bookFont';
  const SAVE_DELAY = 1500;
  const THEMES = {
    dark: { html: { background: '#1e1e1e !important' }, body: { background: '#1e1e1e !important', color: '#d4d4d4 !important', 'line-height': '1.6 !important' }, 'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6': { color: '#d4d4d4 !important' }, a: { color: '#b9a7e0 !important' } },
    light: { html: { background: '#f6f3ec !important' }, body: { background: '#f6f3ec !important', color: '#222 !important', 'line-height': '1.6 !important' }, 'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6': { color: '#222 !important' }, a: { color: '#5a3fa0 !important' } },
  };

  let books = [];
  let current = null;
  let epub = null;
  let rendition = null;
  let openToken = 0;
  let pending = null;
  let saveTimer = 0;
  const stored = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let theme = stored(THEME_KEY, 'dark') === 'light' ? 'light' : 'dark';
  let fontPercent = Math.min(200, Math.max(70, Number(stored(FONT_KEY, '110')) || 110));

  function say(text, error = false) {
    note.textContent = text;
    note.classList.toggle('error', error);
  }
  async function booksApi(path, options) {
    const response = await fetch('/api/books' + path, options);
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
    return result;
  }
  function formatSize(bytes) {
    return bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
  }
  function describeProgress(book) {
    if (book.format === 'pdf') {
      const page = Number((book.position || '').replace('page:', ''));
      return page ? 'page ' + page : 'not started';
    }
    return book.position ? Math.round(book.progress * 100) + '%' : 'not started';
  }

  function renderShelf() {
    shelf.replaceChildren();
    if (!books.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No books yet. Upload a PDF or an EPUB, or drop one here.';
      shelf.append(empty);
      return;
    }
    for (const book of books) {
      const row = document.createElement('div');
      row.className = 'book';
      const open = document.createElement('button');
      open.className = 'book-open';
      const title = document.createElement('span');
      title.className = 'book-title';
      title.textContent = book.title;
      const meta = document.createElement('span');
      meta.className = 'book-meta';
      meta.textContent = `${book.format.toUpperCase()} · ${formatSize(book.size)} · ${describeProgress(book)}`;
      open.append(title, meta);
      open.onclick = () => openBook(book);
      const rename = document.createElement('button');
      rename.className = 'book-action';
      rename.textContent = 'Rename';
      rename.onclick = () => renameBook(book);
      const remove = document.createElement('button');
      remove.className = 'book-action danger';
      remove.textContent = 'Delete';
      remove.onclick = () => deleteBook(book);
      row.append(open, rename, remove);
      shelf.append(row);
    }
  }
  async function loadBooks() {
    try {
      books = await booksApi('');
      renderShelf();
    } catch (error) { say(error.message, true); }
  }
  async function renameBook(book) {
    const title = prompt('Book title', book.title);
    if (title === null || title.trim() === book.title) return;
    try {
      Object.assign(book, await booksApi('/' + book.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }));
      renderShelf();
    } catch (error) { say(error.message, true); }
  }
  async function deleteBook(book) {
    if (!confirm(`Delete "${book.title}" and its file? This cannot be undone.`)) return;
    try {
      await booksApi('/' + book.id, { method: 'DELETE' });
      books = books.filter(item => item.id !== book.id);
      renderShelf();
      say('Deleted');
    } catch (error) { say(error.message, true); }
  }

  function upload(file) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/books?name=' + encodeURIComponent(file.name));
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.upload.onprogress = event => {
        if (event.lengthComputable) say(`Uploading ${file.name}: ${Math.round(event.loaded / event.total * 100)}%`);
      };
      request.onload = () => {
        let result = {};
        try { result = JSON.parse(request.responseText); } catch {}
        if (request.status >= 200 && request.status < 300) resolve(result);
        else reject(new Error(result.error || 'The upload failed. Please try again.'));
      };
      request.onerror = () => reject(new Error('The upload failed. Check your connection.'));
      request.send(file);
    });
  }
  async function uploadFiles(files) {
    for (const file of files) {
      if (!/\.(pdf|epub)$/i.test(file.name)) { say(`${file.name}: use a PDF or an EPUB file.`, true); continue; }
      if (file.size > MAX_BOOK_BYTES) { say(`${file.name} is too large. The limit is 95 MB.`, true); continue; }
      try {
        const book = await upload(file);
        books.unshift(book);
        renderShelf();
        say('Uploaded ' + book.title);
      } catch (error) { say(error.message, true); }
    }
  }
  uploadButton.onclick = () => fileInput.click();
  fileInput.onchange = () => { uploadFiles([...fileInput.files]); fileInput.value = ''; };
  view.addEventListener('dragover', event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    view.classList.add('book-drop');
  });
  view.addEventListener('dragleave', event => { if (!view.contains(event.relatedTarget)) view.classList.remove('book-drop'); });
  view.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    view.classList.remove('book-drop');
    uploadFiles([...event.dataTransfer.files]);
  });

  // The reading position is saved a moment after the last change, and at once
  // when the page hides, so closing the tab does not lose the place.
  function savePosition(position, progress) {
    if (!current) return;
    current.position = position;
    current.progress = progress;
    pending = { id: current.id, position, progress };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPosition, SAVE_DELAY);
  }
  function flushPosition() {
    clearTimeout(saveTimer);
    if (!pending) return;
    const { id, position, progress } = pending;
    pending = null;
    fetch('/api/books/' + id + '/position', {
      method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position, progress }),
    }).catch(() => {});
  }
  window.addEventListener('pagehide', flushPosition);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPosition(); });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the EPUB reader.'));
      document.head.append(script);
    });
  }
  let libraries = null;
  function loadLibraries() {
    if (!libraries) {
      libraries = loadScript('/vendor/jszip.min.js').then(() => loadScript('/vendor/epub.min.js')).catch(error => { libraries = null; throw error; });
    }
    return libraries;
  }

  function openPdf(book, page) {
    const number = page || Number((book.position || '').replace('page:', '')) || 1;
    const frame = document.createElement('iframe');
    frame.title = book.title;
    frame.src = `/api/books/${book.id}/file#page=${number}`;
    stage.replaceChildren(frame);
    pageInput.value = number;
  }
  pageInput.onchange = () => {
    const number = Math.max(1, Math.floor(Number(pageInput.value)) || 1);
    pageInput.value = number;
    if (current?.format !== 'pdf') return;
    openPdf(current, number);
    savePosition('page:' + number, 0);
  };

  function applyEpubStyle() {
    if (!rendition) return;
    rendition.themes.select(theme);
    rendition.themes.fontSize(fontPercent + '%');
    stage.dataset.theme = theme;
    themeButton.textContent = theme === 'dark' ? 'Light' : 'Dark';
  }
  function onRelocated(location) {
    if (!location?.start || !epub || !current) return;
    const cfi = location.start.cfi;
    // Until the locations exist, epub.js reports 0. Keep the stored value then,
    // so opening a book does not reset its progress.
    const progress = epub.locations.length() ? epub.locations.percentageFromCfi(cfi) : current.progress;
    progressLabel.textContent = Math.round(progress * 100) + '%';
    savePosition(cfi, progress);
  }
  async function openEpub(book, token) {
    await loadLibraries();
    const response = await fetch(`/api/books/${book.id}/file`);
    if (!response.ok) throw new Error('Could not load the book file.');
    const data = await response.arrayBuffer();
    if (token !== openToken) return;
    epub = ePub(data);
    stage.replaceChildren();
    rendition = epub.renderTo(stage, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
    for (const [name, rules] of Object.entries(THEMES)) rendition.themes.register(name, rules);
    applyEpubStyle();
    rendition.on('relocated', onRelocated);
    rendition.on('keyup', keyboardTurn);
    await rendition.display(book.position || undefined);
    if (token !== openToken) return;
    const opened = epub;
    opened.loaded.navigation.then(navigation => {
      if (epub !== opened) return;
      toc.replaceChildren(new Option('Contents', ''));
      const add = (items, depth) => items.forEach(item => {
        toc.append(new Option('  '.repeat(depth) + item.label.trim(), item.href));
        if (item.subitems?.length) add(item.subitems, depth + 1);
      });
      add(navigation.toc, 0);
    });
    // Locations turn a position into a percentage. They take a moment to compute.
    opened.ready.then(() => opened.locations.generate(1600)).then(() => {
      if (epub === opened) onRelocated(rendition.currentLocation());
    }).catch(() => {});
  }
  toc.onchange = () => { if (rendition && toc.value) rendition.display(toc.value); toc.value = ''; };
  smaller.onclick = () => { fontPercent = Math.max(70, fontPercent - 10); remember(FONT_KEY, fontPercent); applyEpubStyle(); };
  larger.onclick = () => { fontPercent = Math.min(200, fontPercent + 10); remember(FONT_KEY, fontPercent); applyEpubStyle(); };
  themeButton.onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; remember(THEME_KEY, theme); applyEpubStyle(); };
  prevButton.onclick = () => rendition?.prev();
  nextButton.onclick = () => rendition?.next();
  function keyboardTurn(event) {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') rendition?.next();
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') rendition?.prev();
  }
  document.addEventListener('keydown', event => {
    if (main.dataset.page !== 'books' || !rendition || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); keyboardTurn(event); }
  });

  async function openBook(book) {
    closeReader();
    const token = ++openToken;
    current = book;
    readerTitle.textContent = book.title;
    reader.dataset.format = book.format;
    library.hidden = true;
    reader.hidden = false;
    say('');
    try {
      if (book.format === 'pdf') openPdf(book);
      else {
        stage.textContent = 'Loading…';
        progressLabel.textContent = book.position ? Math.round(book.progress * 100) + '%' : '';
        await openEpub(book, token);
      }
    } catch (error) {
      // A newer open or a close has already replaced this one; leave it alone.
      if (token !== openToken) return;
      closeReader();
      say(error.message, true);
    }
  }
  function closeReader() {
    openToken += 1;
    flushPosition();
    rendition?.destroy();
    epub?.destroy();
    rendition = null;
    epub = null;
    current = null;
    stage.replaceChildren();
    toc.replaceChildren();
    reader.hidden = true;
    library.hidden = false;
    renderShelf();
  }
  backButton.onclick = closeReader;

  function showBooks() {
    showReport(false);
    main.dataset.page = 'books';
    loadBooks();
  }
  // showReport in app.js calls this whenever the page changes, so it also runs
  // when the notes or the report open. It must do nothing if no reader is open.
  window.closeBooks = () => { if (current) closeReader(); };
  openButton.onclick = showBooks;
  closeButton.onclick = () => showReport(false);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || main.dataset.page !== 'books' || event.isComposing) return;
    event.preventDefault();
    if (current) closeReader();
    else showReport(false);
  });
})();
