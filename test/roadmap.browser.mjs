// Playwright integration test. Pass public file contents keyed by /filename.
// The fake server is shared by both pages to exercise persistence across devices.
export default async function testRoadmap(page, files) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const store = new Map([['two-sum', { problem_id: 'two-sum', completed: 1, updated_at: new Date().toISOString() }]]);
  let failRead = false;
  let failWrite = false;
  let holdRead = false;
  let releaseRead;
  let readStarted;
  let releaseNotes;
  let notesStarted;
  const notesReady = new Promise(resolve => { notesStarted = resolve; });
  let firstNotes = true;
  const notes = [{ id: 'plan', title: 'Plan', content: '# Plan\nKeep learning.', version: 1 }];
  await page.context().route('http://roadmap.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/roadmap') {
      if (failRead) return route.fulfill({ status: 503, json: { error: 'Progress is unavailable.' } });
      const snapshot = [...store.values()].map(row => ({ ...row }));
      if (holdRead) {
        holdRead = false;
        await new Promise(resolve => { releaseRead = resolve; readStarted(); });
      }
      return route.fulfill({ json: snapshot });
    }
    if (url.pathname.startsWith('/api/roadmap/')) {
      if (failWrite) return route.fulfill({ status: 503, json: { error: 'The save failed.' } });
      const id = url.pathname.split('/').pop();
      const row = { problem_id: id, completed: Number(route.request().postDataJSON().completed), updated_at: new Date().toISOString() };
      store.set(id, row);
      return route.fulfill({ json: row });
    }
    if (url.pathname === '/api/notes' && !url.search) {
      if (firstNotes) {
        firstNotes = false;
        await new Promise(resolve => { releaseNotes = resolve; notesStarted(); });
      }
      return route.fulfill({ json: notes });
    }
    if (url.pathname === '/api/notes/plan') return route.fulfill({ json: notes[0] });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!(path in files)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: files[path], contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const checkbox = (id, target = page) => target.locator('#roadmap-problem-' + id + ' input');
  const saved = target => target.waitForFunction(() => document.querySelector('#roadmap-status').textContent === 'Progress saved across devices');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://roadmap.test/#/roadmap');
  assert(page.url().endsWith('#/roadmap'), 'Initial note loading does not erase the deep link');
  await notesReady;
  releaseNotes();
  await saved(page);
  assert(await page.locator('#app-main').getAttribute('data-page') === 'roadmap', 'Direct link opens the roadmap after notes initialize');
  assert(await page.locator('#roadmap-stages input').count() === 150, 'All 150 checkboxes are present');
  assert(await page.locator('.roadmap-stage').count() === 10, 'All ten stages are present');
  assert(await page.locator('#roadmap-count').textContent() === '1 / 150', 'Server progress populates totals');
  assert(await checkbox('two-sum').isChecked(), 'Saved checkbox is restored');
  assert(await page.locator('#mobile-title').textContent() === 'Roadmap', 'Mobile header identifies the page');

  const layouts = [];
  for (const width of [320, 390, 600, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, `No horizontal page overflow at ${width}px`);
    layouts.push({ width, overflow });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#roadmap-continue').click();
  assert(await page.locator('#roadmap-stage-foundations').getAttribute('open') !== null, 'Continue expands the next stage');
  await checkbox('merge-sorted-array').check();
  await saved(page);
  assert(store.get('merge-sorted-array').completed === 1, 'Checking persists to the server');
  assert(await page.locator('#roadmap-count').textContent() === '2 / 150', 'Overall progress updates');

  await page.reload();
  await saved(page);
  assert(await checkbox('merge-sorted-array').isChecked(), 'Progress survives reload');
  await page.locator('#roadmap-search').fill('Merge Sorted Array');
  assert(await page.locator('.roadmap-problem:visible').count() === 1, 'Search opens and narrows the matching stage');
  assert(await page.locator('#roadmap-problem-merge-sorted-array a').getAttribute('href') === 'https://leetcode.com/problems/merge-sorted-array/', 'Problem links point to LeetCode');
  await page.locator('#roadmap-filter').selectOption('remaining');
  assert(await page.locator('#roadmap-empty').isVisible(), 'Empty filtered results are explained');
  await page.locator('#roadmap-filter').selectOption('completed');
  assert(await page.locator('.roadmap-problem:visible').count() === 1, 'Completed filter works');
  await checkbox('merge-sorted-array').uncheck();
  await saved(page);
  assert(store.get('merge-sorted-array').completed === 0, 'Unchecking persists too');

  await page.locator('#roadmap-filter').selectOption('all');
  failWrite = true;
  await checkbox('merge-sorted-array').check();
  await page.waitForFunction(() => document.querySelector('#roadmap-status').classList.contains('error'));
  assert(!(await checkbox('merge-sorted-array').isChecked()), 'Failed save rolls back checkbox');
  assert(await page.locator('#roadmap-retry').isVisible(), 'Failed save offers reload / retry');
  assert(await page.locator('#roadmap-count').textContent() === '1 / 150', 'Failed save does not inflate totals');
  failWrite = false;
  await page.locator('#roadmap-retry').click();
  await saved(page);

  // Hold an old GET response while a new checkbox save completes.
  holdRead = true;
  const readReady = new Promise(resolve => { readStarted = resolve; });
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await readReady;
  await checkbox('merge-sorted-array').check();
  await saved(page);
  releaseRead();
  await page.waitForFunction(() => document.querySelector('#roadmap-stages').getAttribute('aria-busy') === 'false');
  assert(await checkbox('merge-sorted-array').isChecked(), 'Stale GET cannot undo a newer checkbox save');

  const other = await page.context().newPage();
  try {
    await other.goto('http://roadmap.test/#/roadmap');
    await saved(other);
    assert(await checkbox('merge-sorted-array', other).isChecked(), 'A second device sees saved progress');
    await other.locator('#roadmap-search').fill('Merge Sorted Array');
    await checkbox('merge-sorted-array', other).uncheck();
    await saved(other);
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !document.querySelector('#roadmap-problem-merge-sorted-array input').checked);
    assert(await checkbox('two-sum').isChecked(), 'Refreshing another device preserves unrelated progress');
  } finally { await other.close(); }

  await page.locator('#mobile-nav').click();
  await page.keyboard.press('Escape');
  assert(await page.locator('#app-main').getAttribute('data-page') === 'roadmap', 'Escape closes the drawer without leaving the roadmap');
  await page.locator('#mobile-nav').click();
  await page.locator('#books-open').click();
  await page.waitForFunction(() => document.querySelector('#app-main').dataset.page === 'books');
  await page.locator('#mobile-nav').click();
  await page.locator('#roadmap-open').click();
  await page.waitForFunction(() => document.querySelector('#app-main').dataset.page === 'roadmap');
  await saved(page);
  assert(await page.locator('#sidebar').isHidden(), 'Entering Roadmap dismisses mobile navigation');
  await page.locator('#roadmap-close').click();
  assert(!page.url().includes('#/roadmap'), 'Back to notes clears the route');
  assert(await page.locator('#content').inputValue() === notes[0].content, 'Roadmap never alters the note');

  failRead = true;
  await page.goto('http://roadmap.test/#/roadmap');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#roadmap-status').classList.contains('error'));
  assert(await checkbox('two-sum').isDisabled(), 'Failed initial load cannot overwrite unknown progress');
  failRead = false;
  await page.locator('#roadmap-retry').click();
  await saved(page);
  assert(await checkbox('two-sum').isChecked(), 'Retry restores server progress');
  assert(errors.length === 0, 'No page errors: ' + errors.join('; '));
  await page.locator('#roadmap-search').fill('');
  return { passed: true, problems: 150, stages: 10, layouts, savedRows: store.size, pageErrors: errors };
}
