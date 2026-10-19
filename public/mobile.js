// A single navigation drawer on phones; the existing sidebar stays intact on desktop.
(() => {
  const phone = matchMedia('(max-width: 600px)');
  const sidebar = document.querySelector('#sidebar');
  const header = document.querySelector('.mobile-header');
  const main = document.querySelector('#app-main');
  const openButton = document.querySelector('#mobile-nav');
  const closeButton = document.querySelector('#mobile-nav-close');
  const backdrop = document.querySelector('#nav-backdrop');
  const title = document.querySelector('#mobile-title');
  const more = document.querySelector('.more');
  const toolbar = document.querySelector('.toolbar');
  const moreMenu = document.querySelector('#more-menu');
  const image = document.querySelector('#add-image');
  const format = document.querySelector('#format-group');
  const unravel = document.querySelector('#unravel');
  const timer = document.querySelector('#mobile-timer');
  let open = false;

  function setOpen(value, restoreFocus = true) {
    open = phone.matches && value;
    document.body.classList.toggle('mobile-nav-open', open);
    backdrop.hidden = !open;
    openButton.setAttribute('aria-expanded', String(open));
    sidebar.inert = phone.matches && !open;
    main.inert = open;
    header.inert = open;
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      sidebar.setAttribute('aria-labelledby', 'sidebar-title');
      closeButton.focus({ preventScroll: true });
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      sidebar.removeAttribute('aria-labelledby');
      if (restoreFocus && phone.matches) openButton.focus({ preventScroll: true });
    }
  }
  window.mobileNavigation = { open: () => setOpen(true), close: (restoreFocus = true) => setOpen(false, restoreFocus) };
  openButton.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('button, input, a[href], [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length && !node.closest('[hidden]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('note-shown', () => { if (open) setOpen(false); });

  function updateTitle() {
    const page = main.dataset.page;
    more.hidden = phone.matches && page !== 'notes';
    const label = page === 'notes' ? main.dataset.noteTitle || 'New note'
      : { books: 'Books', files: 'Files', report: 'Time report', roadmap: 'Roadmap' }[page] || 'Notes';
    if (title.textContent !== label) title.textContent = label;
    title.title = label;
  }
  new MutationObserver(records => {
    updateTitle();
    if (open && main.dataset.page !== 'notes' && records.some(record => record.attributeName === 'data-page')) setOpen(false);
  }).observe(main, { attributes: true, attributeFilter: ['data-page', 'data-note-title'] });

  function updateTimer() {
    timer.hidden = !document.querySelector('#toggle-timer').classList.contains('running');
    timer.textContent = '● ' + document.querySelector('#clock').textContent;
  }
  new MutationObserver(updateTimer).observe(document.querySelector('.timer'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  timer.addEventListener('click', () => { setOpen(true); document.querySelector('#toggle-timer').focus(); });

  function layout() {
    // Move existing controls, rather than duplicate handlers or state.
    setOpen(false, false);
    if (phone.matches) {
      header.append(more);
      moreMenu.prepend(image, unravel);
    } else {
      toolbar.append(more);
      toolbar.insertBefore(unravel, format);
      format.append(image);
    }
    updateTitle();
    updateTimer();
  }
  phone.addEventListener('change', layout);
  layout();
})();
