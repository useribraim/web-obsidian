// Files: send a file of up to 1 MB to this site, and download it from any device
// after you sign in. The bytes live in R2; the server keeps the name and size.
// #/files is the address of the page, as #/books is for the books.
(() => {
  const view = document.querySelector('#files-view');
  const shelf = document.querySelector('#files-list');
  const note = document.querySelector('#files-note');
  const uploadButton = document.querySelector('#files-upload');
  const closeButton = document.querySelector('#files-close');
  const input = document.querySelector('#file-input');

  const MAX_FILE_BYTES = 1_000_000;
  let files = [];

  function say(text, error = false) {
    note.textContent = text;
    note.classList.toggle('error', error);
  }
  async function filesApi(path, options) {
    const response = await fetch('/api/files' + path, options);
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
    return result;
  }
  function formatSize(bytes) {
    return bytes >= 1e6 ? (bytes / 1e6).toFixed(2) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
  }
  const formatDate = iso => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function render() {
    shelf.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No files yet. Upload one, or drop it here.';
      shelf.append(empty);
      return;
    }
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'book';
      // The link downloads the file. The server sends it as an attachment.
      const link = document.createElement('a');
      link.className = 'book-open';
      link.href = '/api/files/' + file.id;
      link.download = file.name;
      const title = document.createElement('span');
      title.className = 'book-title';
      title.textContent = file.name;
      const meta = document.createElement('span');
      meta.className = 'book-meta';
      meta.textContent = `${formatSize(file.size)} · ${formatDate(file.created_at)} · click to download`;
      link.append(title, meta);
      const remove = document.createElement('button');
      remove.className = 'book-action danger';
      remove.textContent = 'Delete';
      remove.onclick = () => askDelete(file, remove);
      row.append(link, remove);
      shelf.append(row);
    }
  }
  async function load() {
    try {
      files = await filesApi('');
      render();
    } catch (error) { say(error.message, true); }
  }

  // Delete asks twice: the first click arms the button, the second one deletes.
  function askDelete(file, button) {
    if (button.dataset.armed) { remove(file); return; }
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
  async function remove(file) {
    try {
      await filesApi('/' + file.id, { method: 'DELETE' });
      files = files.filter(item => item.id !== file.id);
      render();
      say('Deleted');
    } catch (error) { say(error.message, true); render(); }
  }

  function upload(file) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/files?name=' + encodeURIComponent(file.name));
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
  async function uploadFiles(list) {
    for (const file of list) {
      if (file.size === 0) { say(`${file.name} is empty.`, true); continue; }
      if (file.size > MAX_FILE_BYTES) { say(`${file.name} is too large. The limit is 1 MB.`, true); continue; }
      try {
        const saved = await upload(file);
        files.unshift(saved);
        render();
        say('Uploaded ' + saved.name);
      } catch (error) { say(error.message, true); }
    }
  }
  uploadButton.onclick = () => input.click();
  input.onchange = () => { uploadFiles([...input.files]); input.value = ''; };
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

  // The address decides what is on screen. A link, a reload and the back button
  // all end up in route().
  function route() {
    if (location.hash !== '#/files') { if (main.dataset.page === 'files') showReport(false); return; }
    if (main.dataset.page === 'files') return;
    showReport(false);
    main.dataset.page = 'files';
    say('');
    load();
  }
  window.addEventListener('hashchange', route);
  const bootRoute = window.routeBooks;
  // app.js calls routeBooks once the first note has loaded; run this one then too.
  window.routeBooks = () => { bootRoute?.(); route(); };
  // showReport in app.js calls this when the page changes to the notes, the
  // report or the books. Leaving by a click on a note clears the address.
  window.closeFiles = () => {
    if (main.dataset.page !== 'files') return;
    if (location.hash === '#/files') history.pushState(null, '', location.pathname + location.search);
  };
  closeButton.onclick = () => showReport(false);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && main.dataset.page === 'files' && !event.isComposing) { event.preventDefault(); showReport(false); }
  });
})();
