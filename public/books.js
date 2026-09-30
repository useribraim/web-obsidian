// Books: a library of PDF and EPUB files, and a reader for each. The files live
// in R2; the server keeps the title and the reading position. A PDF is drawn by
// pdf.js (see pdf-view.js). An EPUB is drawn by epub.js. Both load on first use.
// The address decides what is on screen: #/books is the library and
// #/books/<id> is a book, so reload and the back button work.
(() => {
  const view = document.querySelector('#books-view');
  const shelf = document.querySelector('#books-list');
  const note = document.querySelector('#books-note');
  const library = document.querySelector('#library');
  const reader = document.querySelector('#reader');
  const stage = document.querySelector('#reader-stage');
  const readerBar = document.querySelector('.reader-bar');
  const readerTitle = document.querySelector('#reader-title');
  const toc = document.querySelector('#reader-toc');
  const smaller = document.querySelector('#reader-smaller');
  const larger = document.querySelector('#reader-larger');
  const themeButton = document.querySelector('#reader-theme');
  const pageInput = document.querySelector('#reader-page');
  const pageTotal = document.querySelector('#reader-pages');
  const prevButton = document.querySelector('#reader-prev');
  const nextButton = document.querySelector('#reader-next');
  const progressLabel = document.querySelector('#reader-progress');
  const sidebarButton = document.querySelector('#reader-sidebar');
  const uploadButton = document.querySelector('#books-upload');
  const closeButton = document.querySelector('#books-close');
  const fileInput = document.querySelector('#book-file');

  const MAX_BOOK_BYTES = 95_000_000;
  const SAVE_DELAY = 1500;
  const ROUTE = /^#\/books(?:\/([a-f0-9-]{36}))?$/;
  const THEME_KEY = 'bookTheme';
  const FONT_KEY = 'bookFont';
  const NIGHT_KEY = 'bookPdfNight';
  const ZOOM_KEY = 'bookZoom';
  const SIDEBAR_KEY = 'bookSidebar';
  const THEMES = {
    dark: { html: { background: '#1e1e1e !important' }, body: { background: '#1e1e1e !important', color: '#d4d4d4 !important', 'line-height': '1.6 !important' }, 'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6': { color: '#d4d4d4 !important' }, a: { color: '#b9a7e0 !important' } },
    light: { html: { background: '#f6f3ec !important' }, body: { background: '#f6f3ec !important', color: '#222 !important', 'line-height': '1.6 !important' }, 'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6': { color: '#222 !important' }, a: { color: '#5a3fa0 !important' } },
  };

  let books = [];
  let current = null;
  let pdf = null;
  let epub = null;
  let rendition = null;
  let openToken = 0;
  let pending = null;
  let saveTimer = 0;
  const stored = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let theme = stored(THEME_KEY, 'dark') === 'light' ? 'light' : 'dark';
  let fontPercent = Math.min(200, Math.max(70, Number(stored(FONT_KEY, '110')) || 110));
  let night = stored(NIGHT_KEY, '0') === '1';
  let zoom = Math.min(3, Math.max(0.5, Number(stored(ZOOM_KEY, '1')) || 1));
  // On a narrow screen the sidebar is hidden while you read, unless you chose otherwise.
  let sidebarHidden = stored(SIDEBAR_KEY, window.matchMedia('(max-width: 600px)').matches ? 'hidden' : 'shown') === 'hidden';

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
  // A PDF position is "page:12" or "page:12:0.40", the second number being how
  // far down the page the top edge of the screen was.
  function parsePdfPosition(position) {
    const match = /^page:(\d+)(?::([\d.]+))?$/.exec(position || '');
    return match ? { page: Number(match[1]), offset: Math.min(1, Number(match[2]) || 0) } : null;
  }
  function describeProgress(book) {
    if (!book.position) return 'not started';
    const percent = Math.round(book.progress * 100) + '%';
    if (book.format === 'epub') return percent;
    const at = parsePdfPosition(book.position);
    return at ? `page ${at.page} · ${percent}` : 'not started';
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
      const open = document.createElement('a');
      open.className = 'book-open';
      open.href = '#/books/' + book.id;
      const title = document.createElement('span');
      title.className = 'book-title';
      title.textContent = book.title;
      const meta = document.createElement('span');
      meta.className = 'book-meta';
      meta.textContent = `${book.format.toUpperCase()} · ${formatSize(book.size)} · ${describeProgress(book)}`;
      open.append(title, meta);
      const rename = document.createElement('button');
      rename.className = 'book-action';
      rename.textContent = 'Rename';
      rename.onclick = () => startRename(book, open);
      const remove = document.createElement('button');
      remove.className = 'book-action danger';
      remove.textContent = 'Delete';
      remove.onclick = () => askDelete(book, remove);
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

  // Rename in place: Enter or leaving the box saves, Escape cancels.
  function startRename(book, open) {
    const input = document.createElement('input');
    input.className = 'book-rename';
    input.value = book.title;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Book title');
    open.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      const title = input.value.trim();
      if (save && title && title !== book.title) {
        try {
          Object.assign(book, await booksApi('/' + book.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }));
        } catch (error) { say(error.message, true); }
      }
      renderShelf();
    };
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    };
    input.onblur = () => finish(true);
  }
  // Delete asks twice: the first click arms the button, the second one deletes.
  function askDelete(book, button) {
    if (button.dataset.armed) { deleteBook(book); return; }
    button.dataset.armed = '1';
    button.textContent = 'Delete forever?';
    button.classList.add('armed');
    const disarm = () => {
      clearTimeout(timer);
      delete button.dataset.armed;
      button.textContent = 'Delete';
      button.classList.remove('armed');
    };
    const timer = setTimeout(disarm, 4000);
    button.onblur = disarm;
  }
  async function deleteBook(book) {
    try {
      await booksApi('/' + book.id, { method: 'DELETE' });
      books = books.filter(item => item.id !== book.id);
      renderShelf();
      say('Deleted');
    } catch (error) { say(error.message, true); renderShelf(); }
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

  // PDF
  function onPdfPage(page, offset, count) {
    if (!current || current.format !== 'pdf') return;
    if (document.activeElement !== pageInput) pageInput.value = page;
    const progress = Math.min(1, (page - 1 + offset) / count);
    progressLabel.textContent = Math.round(progress * 100) + '%';
    const saved = parsePdfPosition(current.position);
    // Opening a book at its start, or at the place already saved, saves nothing.
    if (!saved && page === 1 && offset < 0.005) return;
    if (saved && saved.page === page && Math.abs(saved.offset - offset) < 0.02) return;
    savePosition(`page:${page}:${offset.toFixed(2)}`, progress);
  }
  async function openPdf(book, token) {
    const opened = new window.PdfView(stage, { onPage: onPdfPage });
    pdf = opened;
    opened.setNight(night);
    const saved = parsePdfPosition(book.position);
    await opened.open(`/api/books/${book.id}/file`, { page: saved?.page, offset: saved?.offset, zoom });
    if (token !== openToken) return;
    pageInput.max = opened.pageCount;
    pageInput.value = saved?.page || 1;
    pageTotal.textContent = ' / ' + opened.pageCount;
    progressLabel.textContent = book.position ? Math.round(book.progress * 100) + '%' : '';
    opened.focus();
    opened.outline().then(items => {
      if (pdf !== opened) return;
      toc.replaceChildren(new Option('Contents', ''));
      items.forEach((item, index) => toc.append(new Option('  '.repeat(item.depth) + item.title, String(index))));
      toc.hidden = !items.length;
      toc.pdfItems = items;
    }).catch(() => {});
  }
  pageInput.onchange = () => {
    if (!pdf) return;
    const number = Math.min(pdf.pageCount, Math.max(1, Math.floor(Number(pageInput.value)) || 1));
    pageInput.value = number;
    pdf.goTo(number);
    pdf.focus();
  };

  // EPUB
  function applyEpubStyle() {
    if (!rendition) return;
    rendition.themes.select(theme);
    rendition.themes.fontSize(fontPercent + '%');
    stage.dataset.theme = theme;
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
    // Keys pressed inside the book's own frame do not reach the page, so this is the only place to hear them.
    rendition.on('keyup', event => {
      if (event.key === 'Escape') location.hash = '#/books';
      else keyboardTurn(event);
    });
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
      toc.hidden = false;
    });
    // Locations turn a position into a percentage. They take a moment to compute.
    opened.ready.then(() => opened.locations.generate(1600)).then(() => {
      if (epub === opened) onRelocated(rendition.currentLocation());
    }).catch(() => {});
  }
  function keyboardTurn(event) {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') rendition?.next();
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') rendition?.prev();
  }
  document.addEventListener('keydown', event => {
    if (main.dataset.page !== 'books' || !rendition || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); keyboardTurn(event); }
  });

  // Controls that work for both formats
  toc.onchange = () => {
    const value = toc.value;
    toc.value = '';
    if (!value) return;
    if (pdf) pdf.goToDestination(toc.pdfItems[Number(value)].dest).then(() => pdf?.focus());
    else if (rendition) rendition.display(value);
  };
  function updateThemeButton() {
    const dark = pdf ? night : theme === 'dark';
    themeButton.textContent = dark ? 'Light' : 'Dark';
  }
  smaller.onclick = () => {
    if (pdf) { zoom = Math.max(0.5, +(zoom - 0.1).toFixed(2)); remember(ZOOM_KEY, zoom); pdf.setZoom(zoom); }
    else { fontPercent = Math.max(70, fontPercent - 10); remember(FONT_KEY, fontPercent); applyEpubStyle(); }
  };
  larger.onclick = () => {
    if (pdf) { zoom = Math.min(3, +(zoom + 0.1).toFixed(2)); remember(ZOOM_KEY, zoom); pdf.setZoom(zoom); }
    else { fontPercent = Math.min(200, fontPercent + 10); remember(FONT_KEY, fontPercent); applyEpubStyle(); }
  };
  themeButton.onclick = () => {
    if (pdf) { night = !night; remember(NIGHT_KEY, night ? '1' : '0'); pdf.setNight(night); }
    else { theme = theme === 'dark' ? 'light' : 'dark'; remember(THEME_KEY, theme); applyEpubStyle(); }
    updateThemeButton();
  };
  prevButton.onclick = () => { if (pdf) pdf.goTo(pdf.position().page - 1); else rendition?.prev(); };
  nextButton.onclick = () => { if (pdf) pdf.goTo(pdf.position().page + 1); else rendition?.next(); };
  // After a click on a button, the keys should scroll the book again.
  readerBar.addEventListener('click', event => { if (pdf && event.target.closest('button')) pdf.focus(); });

  function applySidebar() {
    document.body.classList.toggle('reading-full', sidebarHidden && !reader.hidden);
    sidebarButton.textContent = sidebarHidden ? 'Show sidebar' : 'Hide sidebar';
  }
  sidebarButton.onclick = () => {
    sidebarHidden = !sidebarHidden;
    remember(SIDEBAR_KEY, sidebarHidden ? 'hidden' : 'shown');
    applySidebar();
  };

  async function openBook(book) {
    closeReader();
    const token = ++openToken;
    current = book;
    readerTitle.textContent = book.title;
    reader.dataset.format = book.format;
    document.title = book.title + ' — Notes';
    library.hidden = true;
    reader.hidden = false;
    toc.replaceChildren();
    toc.hidden = true;
    progressLabel.textContent = book.position ? Math.round(book.progress * 100) + '%' : '';
    themeButton.textContent = (book.format === 'pdf' ? night : theme === 'dark') ? 'Light' : 'Dark';
    applySidebar();
    say('');
    stage.textContent = 'Loading…';
    try {
      if (book.format === 'pdf') await openPdf(book, token);
      else await openEpub(book, token);
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
    pdf?.destroy();
    rendition?.destroy();
    epub?.destroy();
    pdf = null;
    rendition = null;
    epub = null;
    current = null;
    stage.replaceChildren();
    stage.removeAttribute('data-theme');
    toc.replaceChildren();
    reader.hidden = true;
    library.hidden = false;
    document.title = 'Notes';
    applySidebar();
    renderShelf();
  }

  // The address is the single source of truth. A link, the back button, a reload
  // and a shared address all end up here.
  function enterBooks() {
    if (main.dataset.page === 'books') return false;
    showReport(false);
    main.dataset.page = 'books';
    return true;
  }
  async function route() {
    const match = ROUTE.exec(location.hash);
    if (!match) { if (main.dataset.page === 'books') showReport(false); return; }
    const fresh = enterBooks();
    if (!match[1]) {
      if (current) closeReader();
      if (fresh || !books.length) await loadBooks();
      return;
    }
    if (current?.id === match[1]) return;
    if (!books.length) await loadBooks();
    let book = books.find(item => item.id === match[1]);
    // A book added in another tab or on another device is not in the list yet.
    if (!book) { await loadBooks(); book = books.find(item => item.id === match[1]); }
    if (!book) { say('That book is not in your library.', true); history.replaceState(null, '', '#/books'); renderShelf(); return; }
    await openBook(book);
  }
  window.routeBooks = route;
  window.addEventListener('hashchange', route);
  // showReport in app.js calls this whenever the page changes to the notes or the
  // report. Leaving by a click on a note must also clear the address.
  window.closeBooks = () => {
    if (main.dataset.page !== 'books') return;
    if (current) closeReader();
    if (location.hash.startsWith('#/books')) history.pushState(null, '', location.pathname + location.search);
  };
  closeButton.onclick = () => showReport(false);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || main.dataset.page !== 'books' || event.isComposing) return;
    event.preventDefault();
    if (current) location.hash = '#/books';
    else showReport(false);
  });
})();
