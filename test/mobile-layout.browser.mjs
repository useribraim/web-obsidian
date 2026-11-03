// Run with a Playwright Page and a map of public asset paths to file contents.
// All requests are intercepted: these tests never use a real account or database.
export default async function testMobileLayout(page, files) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const notes = [
    { id: 'plan', title: 'Plan', content: '### 1 oct\n' + 'Earlier work\n'.repeat(90) + '\n### 16 oct\nA long link: https://example.com/a-long-link-that-should-wrap-in-the-editor\n\n### 17 oct\nWrite something worthwhile.\n', version: 1 },
    { id: 'prompts', title: 'A very long note title that should never push the menu off screen', content: '# Prompts\n\nA second note.', version: 1 },
  ];
  const saved = [];
  let timeEntries = [];
  await page.route('http://mobile-layout.test/**', async route => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname === '/api/notes') data = url.search ? [] : notes;
    else if (url.pathname.startsWith('/api/notes/')) {
      data = notes.find(note => note.id === url.pathname.split('/').pop());
      if (route.request().method() === 'PUT') {
        Object.assign(data, route.request().postDataJSON(), { version: data.version + 1 });
        saved.push(data.content);
      }
    } else if (url.pathname === '/api/time') {
      if (route.request().method() === 'POST') {
        data = { id: 'timer', description: route.request().postDataJSON().description, started_at: new Date().toISOString(), stopped_at: null };
        timeEntries = [data];
      } else data = timeEntries;
    } else if (url.pathname.endsWith('/stop')) {
      timeEntries[0].stopped_at = new Date().toISOString();
      data = timeEntries[0];
    } else if (url.pathname.startsWith('/api/')) data = [];
    if (data !== undefined) return route.fulfill({ json: data });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!(path in files)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: files[path], contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('http://mobile-layout.test/');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
  await frame();
  assert(await page.locator('#mobile-title').textContent() === 'Plan', 'Header shows the current note');
  assert(await page.locator('#sidebar').isHidden(), 'Navigation starts closed');
  assert(await page.locator('#content').evaluate(node => getComputedStyle(node).fontSize) === '16px', 'Phone defaults to readable 16px type');

  const layouts = [];
  for (const width of [320, 360, 390, 412, 600]) {
    await page.setViewportSize({ width, height: 800 });
    await frame();
    const boxes = await page.evaluate(() => {
      const pane = document.querySelector('#content').getBoundingClientRect();
      return { top: pane.top, width: pane.width, height: pane.height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(boxes.top <= 160, `Note begins near the top at ${width}px`);
    assert(boxes.height >= 620, `Note gets most of the screen at ${width}px`);
    assert(Math.abs(boxes.width - (width - 40)) < 1, `Note fills usable width at ${width}px`);
    assert(!boxes.overflow, `No horizontal page overflow at ${width}px`);
    layouts.push({ viewportWidth: width, ...boxes });
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('#mobile-nav').click();
  assert(await page.locator('#sidebar').getAttribute('role') === 'dialog', 'Navigation is a modal drawer');
  assert(await page.locator('#app-main').evaluate(node => node.inert), 'Background cannot receive focus');
  await page.locator('#mobile-nav-close').focus();
  // Focus wraps in both directions, including text-size and timer controls.
  await page.keyboard.press('Shift+Tab');
  assert(await page.locator('#new').evaluate(node => node === document.activeElement), 'Close is preceded by New note');
  await page.locator('#logout').focus();
  await page.keyboard.press('Shift+Tab');
  assert(await page.locator('#size').evaluate(node => node === document.activeElement), 'Tab wraps to the last visible drawer control');
  await page.keyboard.press('Tab');
  assert(await page.locator('#logout').evaluate(node => node === document.activeElement), 'Tab wraps to the first drawer control');
  await page.keyboard.press('Escape');
  assert(await page.locator('#sidebar').isHidden(), 'Escape closes drawer');
  assert(await page.locator('#mobile-nav').evaluate(node => node === document.activeElement), 'Close restores focus');

  await page.locator('#mobile-nav').click();
  await page.locator('#search').fill('No match');
  await page.waitForFunction(() => document.querySelector('#notes').textContent.includes('No note matches'));
  assert(await page.locator('#mobile-title').textContent() === 'Plan', 'Search results do not change the current-note title');
  await page.locator('#search').fill('');
  await page.locator('.note[data-id="prompts"]').click();
  await page.waitForFunction(() => document.querySelector('#mobile-title').textContent.startsWith('A very long'));
  assert(await page.locator('#sidebar').isHidden(), 'Selecting a note closes drawer');
  assert(await page.locator('#content').inputValue() === notes[1].content, 'Selected note loads');
  assert(await page.locator('#more').isVisible(), 'Long titles keep actions visible');

  await page.locator('.view-option[data-view="preview"]').click();
  assert(await page.locator('#content').isHidden(), 'Preview hides editor');
  assert(await page.locator('#preview').isVisible(), 'Preview renders');
  await page.locator('.view-option[data-view="edit"]').click();
  await page.locator('#content').fill('A small edit.');
  await page.locator('#content').press('Control+s');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
  assert(saved.includes('A small edit.'), 'Saving still works');

  await page.setViewportSize({ width: 390, height: 380 });
  await frame();
  assert((await page.locator('#content').boundingBox()).height >= 220, 'Short keyboard-sized viewport leaves usable editing space');
  await page.locator('#more').click();
  assert(await page.locator('#add-image').isVisible(), 'Image upload is available in More');
  assert(await page.locator('#unravel').isVisible(), 'Whole-note action is available in More');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('#mobile-nav').click();
  await page.locator('#books-open').click();
  await page.waitForFunction(() => document.querySelector('#app-main').dataset.page === 'books');
  assert(await page.locator('#sidebar').isHidden(), 'Books dismisses navigation');
  assert(await page.locator('#more').isHidden(), 'Library does not expose unrelated note actions');
  await page.locator('#books-close').click();
  await page.locator('#mobile-nav').click();
  await page.locator('#files-open').click();
  await page.waitForFunction(() => document.querySelector('#app-main').dataset.page === 'files');
  assert(await page.locator('#sidebar').isHidden(), 'Files dismisses navigation');
  await page.locator('#files-close').click();
  await page.locator('#more').click();
  await page.locator('#mobile-rename').click();
  await page.locator('.rename').fill('Renamed on mobile');
  await page.locator('.rename').press('Enter');
  await page.waitForFunction(() => document.querySelector('#mobile-title').textContent === 'Renamed on mobile');
  await page.locator('#size').click();
  await page.locator('[data-size="18"]').click();
  assert(await page.locator('#content').evaluate(node => getComputedStyle(node).fontSize) === '18px', 'Mobile text-size setting works');
  await page.locator('#task').fill('Design the mobile workspace');
  await page.locator('#toggle-timer').click();
  await page.waitForFunction(() => document.querySelector('#toggle-timer').classList.contains('running'));
  await page.locator('#mobile-nav-close').click();
  assert(await page.locator('#mobile-timer').isVisible(), 'Running timer remains visible outside drawer');
  await page.locator('#mobile-timer').click();
  await page.locator('#toggle-timer').click();
  await page.waitForFunction(() => document.querySelector('#mobile-timer').hidden);
  await page.locator('#report').click();
  await page.waitForFunction(() => document.querySelector('#app-main').dataset.page === 'report');
  assert(await page.locator('#sidebar').isHidden(), 'Time report dismisses drawer');
  await page.locator('#close-report').click();
  await page.locator('.view-option[data-view="preview"]').click();
  await page.locator('#mobile-nav').click();
  await page.locator('#new').click();
  assert(await page.locator('#sidebar').isHidden(), 'New note closes drawer');
  assert(await page.locator('#content').isVisible(), 'New note switches from Preview to Edit');
  assert(await page.locator('#content').inputValue() === '', 'New note starts empty');
  assert(await page.locator('#content').evaluate(node => node === document.activeElement), 'New note focuses editor');

  // Desktop preferences must not sabotage the independent mobile layout.
  await page.evaluate(() => { localStorage.setItem('noteFocus', '1'); localStorage.setItem('noteSidebarCollapsed', '1'); localStorage.setItem('noteView', 'split'); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
  assert(await page.locator('#editor').getAttribute('data-view') === 'edit', 'Mobile never inherits desktop split view');
  assert(await page.locator('#content').evaluate(node => getComputedStyle(node).fontSize) === '18px', 'Mobile font preference survives reload');
  await page.locator('#mobile-nav').click();
  assert(await page.locator('#search').isVisible(), 'Desktop collapse and focus do not hide drawer controls');
  assert(await page.locator('#books-open').isVisible(), 'Drawer retains library navigation in Focus mode');
  await page.locator('#mobile-nav-close').click();
  await page.locator('#more').click();
  assert(await page.locator('#add-image').isVisible(), 'Mobile Focus mode keeps useful actions');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 900 });
  await frame();
  assert(await page.locator('.mobile-header').isHidden(), 'Desktop hides mobile header');
  assert(!(await page.locator('#sidebar').evaluate(node => node.inert)), 'Desktop sidebar is not inert');
  assert(await page.locator('#editor').getAttribute('data-view') === 'split', 'Desktop Focus retains split view');
  assert(await page.locator('#more').evaluate(node => Boolean(node.closest('.toolbar'))), 'More returns to desktop toolbar');
  assert(await page.locator('#add-image').evaluate(node => Boolean(node.closest('#format-group'))), 'Image button returns to desktop toolbar');
  await page.evaluate(() => { localStorage.removeItem('noteFocus'); localStorage.removeItem('noteSidebarCollapsed'); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
  assert(await page.locator('#search').isVisible(), 'Normal desktop sidebar still works');
  assert(await page.locator('#content').evaluate(node => getComputedStyle(node).fontSize) === '14px', 'Desktop keeps its own font size');
  assert(errors.length === 0, 'No page errors: ' + errors.join('; '));
  await page.setViewportSize({ width: 390, height: 800 });
  return { passed: true, layouts, savedEdits: saved.length, pageErrors: errors };
}
