import { INTERVIEW_QUESTIONS, gradeRound, mistakesMarkdown } from '../public/interview-data.js';

// Isolated Playwright scenario: intercepted requests never touch real notes.
export default async function testInterview(page, files) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const original = { id: '00000000-0000-4000-8000-000000000001', title: 'Plan', content: '# Plan\nKeep learning.', version: 1, deleted_at: null };
  const notes = new Map([[original.id, original]]);
  let failSave = true;
  let loseResponse = false;
  let writes = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.context().route('https://interview.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/interview/results') {
      writes += 1;
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Test save unavailable.' } });
      const round = request.postDataJSON();
      const result = gradeRound(round.questionIds, round.answers, round.topic);
      if (!notes.has(round.id)) notes.set(round.id, { id: round.id, title: 'Interview mistakes', content: mistakesMarkdown(round), version: 1, updated_at: new Date().toISOString(), deleted_at: null });
      if (loseResponse) { loseResponse = false; return route.abort('failed'); }
      return route.fulfill({ json: { score: result.score, total: 10, note: notes.get(round.id) } });
    }
    if (url.pathname === '/api/notes') return route.fulfill({ json: url.searchParams.has('trash') ? [] : [...notes.values()] });
    if (url.pathname.startsWith('/api/notes/')) return route.fulfill({ json: notes.get(url.pathname.split('/').pop()) });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!(path in files)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: files[path], contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const visiblePage = name => page.waitForFunction(value => document.querySelector('#app-main').dataset.page === value, name);
  const saved = () => page.waitForFunction(() => document.querySelector('#interview-save-status').textContent.startsWith('Saved in your notebook.'));
  const noOverflow = async label => {
    for (const width of [320, 390, 600, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${label}: no overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  const answer = async wrong => {
    const prompt = await page.locator('#interview-question').textContent();
    const item = INTERVIEW_QUESTIONS.find(item => item.prompt === prompt);
    assert(Boolean(item), 'Rendered question is in the bank');
    assert(await page.locator('#interview-check').isDisabled(), 'Cannot submit without an answer');
    await page.locator(`#interview-options input[value="${(item.answer + (wrong ? 1 : 0)) % 4}"]`).check();
    await page.locator('#interview-check').click();
    assert(await page.locator('#interview-options input:disabled').count() === 4, 'Submitted answers are locked');
    assert(await page.locator('.interview-option.correct').count() === 1, 'Correct answer is labelled');
    assert((await page.locator('#interview-feedback').textContent()).includes(item.explanation), 'Feedback explains the answer');
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://interview.test/#/interview');
  await visiblePage('interview');
  assert(page.url().endsWith('#/interview'), 'Deep link survives notebook initialization');
  assert(await page.locator('#mobile-title').textContent() === 'Interview prep', 'Mobile header names the page');
  await noOverflow('Setup');
  await page.locator('#interview-topic').selectOption('javascript');
  await page.locator('#interview-start').click();
  await answer(true);
  await page.reload();
  await visiblePage('interview');
  assert(await page.locator('#interview-step').textContent() === 'Question 1 of 10', 'Reload restores the current question');
  assert(await page.locator('#interview-feedback').isVisible(), 'Reload restores feedback and the committed answer');
  await page.locator('#interview-next').click();
  await page.locator('#interview-close').click();
  await visiblePage('notes');
  assert(!page.url().includes('#/interview'), 'Notes button clears the route');
  assert(await page.locator('#content').inputValue() === original.content, 'Quiz leaves existing note text untouched');
  await page.evaluate(() => { location.hash = '#/interview'; });
  await visiblePage('interview');
  assert(await page.locator('#interview-step').textContent() === 'Question 2 of 10', 'Returning resumes the round');
  await noOverflow('Question');
  for (let i = 1; i < 10; i += 1) {
    await answer(i === 1);
    await page.locator('#interview-next').click();
  }
  await page.waitForFunction(() => document.querySelector('#interview-save-status').classList.contains('error'));
  assert(await page.locator('#interview-score').textContent() === '8 / 10 correct', 'Score reflects submitted answers');
  assert(await page.locator('.interview-mistake').count() === 2, 'Review contains only wrong answers');
  assert(await page.locator('#interview-save-retry').isVisible(), 'Failed save offers retry');
  assert(await page.locator('#interview-again').isDisabled(), 'Unsaved results cannot be silently discarded');
  await noOverflow('Results');
  failSave = false;
  loseResponse = true;
  await page.locator('#interview-save-retry').click();
  await page.waitForFunction(() => document.querySelector('#interview-save-status').classList.contains('error'));
  assert(notes.size === 2, 'Simulated lost response saved exactly one note');
  await page.reload();
  await visiblePage('interview');
  await saved();
  assert(notes.size === 2, 'Automatic recovery retry does not duplicate a note');
  assert(await page.locator('#interview-again').isEnabled(), 'Saved results allow a fresh round');
  const mistakes = [...notes.values()].find(note => note.id !== original.id);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#interview-download').click()]);
  assert(download.suggestedFilename().endsWith('.md'), 'Export is a Markdown file');
  let content = '';
  for await (const chunk of await download.createReadStream()) content += chunk.toString();
  assert(content === mistakes.content, 'Downloaded mistakes match the saved note');
  assert((content.match(/^## Question /gm) || []).length === 2, 'Export excludes correct questions');
  await page.locator('#interview-note').click();
  await visiblePage('notes');
  assert(await page.locator('#content').inputValue() === mistakes.content, 'Saved mistakes open in the notebook');
  await page.locator('#mobile-nav').click();
  await page.locator('#trash').click();
  await page.waitForFunction(() => document.querySelector('#trash').getAttribute('aria-label') === 'Back to notes');
  await page.locator('#interview-open').click();
  await visiblePage('interview');
  await page.locator('#interview-note').click();
  await visiblePage('notes');
  assert(await page.locator('#trash').getAttribute('aria-label') === 'Trash', 'Opening a saved mistake note exits Trash mode');
  assert(await page.locator('#content').inputValue() === mistakes.content, 'Saved note is editable outside Trash');
  await page.evaluate(() => { location.hash = '#/interview'; });
  await visiblePage('interview');
  await page.locator('#mobile-nav').click();
  await page.keyboard.press('Escape');
  assert(await page.locator('#app-main').getAttribute('data-page') === 'interview', 'Escape closes navigation without leaving the quiz');
  await page.locator('#interview-again').click();
  await page.locator('#interview-topic').selectOption('systems');
  await page.locator('#interview-start').click();
  for (let i = 0; i < 10; i += 1) { await answer(false); await page.locator('#interview-next').click(); }
  assert(await page.locator('#interview-score').textContent() === '10 / 10 correct', 'Perfect round scores correctly');
  assert(await page.locator('#interview-download').isHidden(), 'Perfect round has no mistakes download');
  assert(await page.locator('#interview-note').isHidden(), 'Perfect round has no empty note');
  assert(notes.size === 2, 'Perfect round creates no note');
  assert(writes === 3, 'Only mistake rounds use the save API');
  for (const target of ['books', 'files', 'interview']) {
    await page.evaluate(value => { location.hash = '#/' + value; }, target);
    await visiblePage(target);
  }
  await page.locator('#interview-close').click();
  assert(await page.locator('#content').inputValue() === mistakes.content, 'Other page routes do not alter the note');
  await page.evaluate(() => { sessionStorage.setItem('interviewRound:v1', '{broken'); location.hash = '#/interview'; });
  await page.reload();
  await visiblePage('interview');
  assert(await page.locator('#interview-recovery').isVisible(), 'Corrupted round storage gives a recoverable warning');
  assert(await page.locator('#interview-start').isVisible(), 'Corrupted storage does not block starting again');
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'interviewRound:v1') throw new DOMException('Test storage unavailable', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.locator('#interview-start').click();
  assert((await page.locator('#interview-recovery').textContent()).includes('cannot keep this round'), 'Unavailable storage is not silently ignored');
  await answer(false);
  assert(errors.length === 0, 'No page errors: ' + errors.join('; '));
  return { passed: true, rounds: 2, savedMistakes: 2, retryRequests: writes, pageErrors: errors };
}
