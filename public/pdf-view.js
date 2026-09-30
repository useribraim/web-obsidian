// A PDF reader built on pdf.js. The pages sit one below the other in a scroll
// box. Only the pages near the screen are drawn, so a 400-page book stays light.
// The page under the top edge is reported to the caller, which saves it.
(() => {
  const PAD = 16;
  const GAP = 12;
  const MAX_FIT_WIDTH = 1000;
  // Safari refuses a canvas of more than about 16 million pixels.
  const MAX_CANVAS_PIXELS = 16_000_000;

  let library = null;
  function loadPdfjs() {
    if (!library) {
      library = import('/vendor/pdf.min.mjs').then(lib => {
        lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
        return lib;
      }).catch(() => { library = null; throw new Error('Could not load the PDF reader.'); });
    }
    return library;
  }

  class PdfView {
    constructor(host, { onPage }) {
      this.onPage = onPage;
      this.scroll = document.createElement('div');
      this.scroll.className = 'pdf-scroll';
      this.scroll.tabIndex = 0;
      this.scroll.setAttribute('role', 'document');
      this.scroll.setAttribute('aria-label', 'Book pages');
      host.replaceChildren(this.scroll);
      this.pages = [];
      this.zoom = 1;
      this.scale = 1;
      this.lastWidth = 0;
      this.ready = false;
      this.dead = false;
      this.frame = 0;
      this.resizeTimer = 0;
      this.scroll.addEventListener('scroll', () => this.scheduleReport(), { passive: true });
      this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          if (this.ready && this.scroll.clientWidth !== this.lastWidth) this.relayout();
        }, 150);
      });
      this.resizeObserver.observe(this.scroll);
    }

    async open(url, start = {}) {
      this.lib = await loadPdfjs();
      if (this.dead) return;
      this.loading = this.lib.getDocument({ url, disableAutoFetch: true, isEvalSupported: false });
      this.doc = await this.loading.promise;
      if (this.dead) return;
      this.pageCount = this.doc.numPages;
      const first = await this.doc.getPage(1);
      if (this.dead) return;
      const size = first.getViewport({ scale: 1 });
      this.baseWidth = size.width;
      // Every page starts with the size of page 1. A page of another size is
      // corrected when it is drawn.
      this.pages = Array.from({ length: this.pageCount }, (_, index) => ({ n: index + 1, w: size.width, h: size.height, state: '', id: 0 }));
      this.zoom = start.zoom || 1;
      this.build();
      this.layout();
      this.goTo(start.page || 1, start.offset || 0);
      for (const page of this.pages) { this.near.observe(page.el); this.far.observe(page.el); }
      this.ready = true;
    }

    build() {
      this.near = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) this.draw(this.pages[Number(entry.target.dataset.n) - 1]);
      }, { root: this.scroll, rootMargin: '150% 0px' });
      this.far = new IntersectionObserver(entries => {
        for (const entry of entries) if (!entry.isIntersecting) this.release(this.pages[Number(entry.target.dataset.n) - 1]);
      }, { root: this.scroll, rootMargin: '500% 0px' });
      const fragment = document.createDocumentFragment();
      for (const page of this.pages) {
        page.el = document.createElement('div');
        page.el.className = 'pdf-page';
        page.el.dataset.n = page.n;
        page.canvas = document.createElement('canvas');
        page.canvas.width = page.canvas.height = 0;
        page.text = document.createElement('div');
        page.text.className = 'textLayer';
        page.el.append(page.canvas, page.text);
        fragment.append(page.el);
      }
      this.scroll.replaceChildren(fragment);
    }

    layout() {
      this.lastWidth = this.scroll.clientWidth;
      const available = Math.max(120, this.lastWidth - 2 * PAD);
      this.scale = Math.min(available, MAX_FIT_WIDTH) / this.baseWidth * this.zoom;
      for (const page of this.pages) this.sizePage(page);
    }
    sizePage(page) {
      page.el.style.width = page.w * this.scale + 'px';
      page.el.style.height = page.h * this.scale + 'px';
      page.el.style.marginBottom = GAP + 'px';
    }
    // Drawn pages are dropped and drawn again, at the new scale, when they show.
    relayout() {
      const at = this.position();
      for (const page of this.pages) this.release(page);
      this.layout();
      this.goTo(at.page, at.offset);
      for (const page of this.pages) { this.near.unobserve(page.el); this.near.observe(page.el); this.far.observe(page.el); }
    }
    setZoom(zoom) {
      this.zoom = Math.min(3, Math.max(0.5, zoom));
      if (this.ready) this.relayout();
    }

    async draw(page) {
      if (page.state || this.dead) return;
      page.state = 'loading';
      const id = ++page.id;
      const alive = () => !this.dead && page.id === id;
      try {
        const pdfPage = await this.doc.getPage(page.n);
        if (!alive()) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        if (natural.width !== page.w || natural.height !== page.h) this.resizePage(page, natural.width, natural.height);
        const viewport = pdfPage.getViewport({ scale: this.scale });
        let ratio = window.devicePixelRatio || 1;
        while (ratio > 1 && viewport.width * viewport.height * ratio * ratio > MAX_CANVAS_PIXELS) ratio -= 0.25;
        const canvas = page.canvas;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        page.state = 'drawing';
        page.task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await page.task.promise;
        if (!alive()) return;
        // The text layer makes the words selectable and findable with Ctrl+F.
        page.text.style.setProperty('--total-scale-factor', String(this.scale));
        page.textLayer = new this.lib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: page.text, viewport });
        await page.textLayer.render();
        if (alive()) page.state = 'drawn';
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && alive()) { page.state = ''; console.error(error); }
      }
    }
    release(page) {
      if (!page.state) return;
      page.id += 1;
      page.state = '';
      try { page.task?.cancel(); } catch {}
      try { page.textLayer?.cancel(); } catch {}
      page.task = null;
      page.textLayer = null;
      page.canvas.width = 0;
      page.canvas.height = 0;
      page.text.replaceChildren();
    }
    // A page taller or shorter than expected must not shift the page you are reading.
    resizePage(page, width, height) {
      const above = page.el.offsetTop + page.el.offsetHeight <= this.scroll.scrollTop;
      const before = page.el.offsetHeight;
      page.w = width;
      page.h = height;
      this.sizePage(page);
      if (above) this.scroll.scrollTop += page.el.offsetHeight - before;
    }

    position() {
      const y = this.scroll.scrollTop;
      let low = 0;
      let high = this.pages.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (this.pages[middle].el.offsetTop <= y + 1) low = middle; else high = middle - 1;
      }
      const page = this.pages[low];
      return { page: page.n, offset: Math.min(1, Math.max(0, (y - page.el.offsetTop) / (page.el.offsetHeight || 1))) };
    }
    goTo(number, offset = 0) {
      const page = this.pages[Math.min(this.pageCount, Math.max(1, Math.floor(number) || 1)) - 1];
      this.scroll.scrollTop = page.el.offsetTop + offset * page.el.offsetHeight;
    }
    scheduleReport() {
      if (this.frame || !this.ready) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const at = this.position();
        this.onPage(at.page, at.offset, this.pageCount);
      });
    }

    async outline() {
      const items = await this.doc.getOutline();
      const flat = [];
      const walk = (list, depth) => list.forEach(item => {
        if (item.dest && item.title?.trim()) flat.push({ title: item.title.trim(), dest: item.dest, depth });
        if (item.items?.length) walk(item.items, depth + 1);
      });
      if (items) walk(items, 0);
      return flat;
    }
    async goToDestination(dest) {
      const target = typeof dest === 'string' ? await this.doc.getDestination(dest) : dest;
      if (!target) return;
      const reference = target[0];
      const index = Number.isInteger(reference) ? reference : await this.doc.getPageIndex(reference);
      this.goTo(index + 1);
    }

    setNight(night) { this.scroll.classList.toggle('night', night); }
    focus() { this.scroll.focus({ preventScroll: true }); }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.frame);
      clearTimeout(this.resizeTimer);
      this.resizeObserver.disconnect();
      this.near?.disconnect();
      this.far?.disconnect();
      for (const page of this.pages) this.release(page);
      try { this.loading?.destroy(); } catch {}
    }
  }

  window.PdfView = PdfView;
})();
