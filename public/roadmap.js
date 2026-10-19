import { ROADMAP, ROADMAP_PROBLEMS } from './roadmap-data.js';

const main = document.querySelector('main');
const stages = document.querySelector('#roadmap-stages');
const status = document.querySelector('#roadmap-status');
const retry = document.querySelector('#roadmap-retry');
const search = document.querySelector('#roadmap-search');
const filter = document.querySelector('#roadmap-filter');
const continueButton = document.querySelector('#roadmap-continue');
const rows = new Map();
const stageViews = [];
const completed = new Set();
const pending = new Set();
let ready = false;
let loading = false;
let revision = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function say(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
  retry.hidden = !error;
}
async function api(path = '', options) {
  const response = await fetch('/api/roadmap' + path, options);
  let result;
  try { result = await response.json(); } catch { throw new Error('Could not read roadmap progress. Please retry.'); }
  if (!response.ok) throw new Error(result.error || 'Could not save or load progress. Please retry.');
  return result;
}
function nextProblem() {
  return ROADMAP_PROBLEMS.find(problem => !completed.has(problem.id) && problem.difficulty !== 'Hard')
    || ROADMAP_PROBLEMS.find(problem => !completed.has(problem.id));
}
function update() {
  const query = search.value.trim().toLowerCase();
  const filtered = Boolean(query) || filter.value !== 'all';
  const active = document.activeElement;
  const next = nextProblem();
  let visibleStages = 0;
  for (const entry of stageViews) {
    let visibleProblems = 0;
    const problems = entry.stage.groups.flatMap(group => group.problems);
    entry.details.classList.toggle('current', Boolean(next && problems.some(problem => problem.id === next.id)));
    const done = problems.filter(problem => completed.has(problem.id)).length;
    entry.count.textContent = `${done} / ${problems.length}`;
    entry.details.classList.toggle('complete', done === problems.length);
    for (const group of entry.groups) {
      let visible = 0;
      for (const problem of group.data.problems) {
        const row = rows.get(problem.id);
        const checked = completed.has(problem.id);
        row.input.checked = checked;
        row.input.disabled = !ready || pending.has(problem.id);
        row.node.classList.toggle('done', checked);
        const matchesText = `${problem.title} ${problem.difficulty} ${group.data.title} ${entry.stage.title}`.toLowerCase().includes(query);
        row.node.hidden = !matchesText || (filter.value === 'remaining' && checked) || (filter.value === 'completed' && !checked);
        if (!row.node.hidden) visible += 1;
      }
      group.node.hidden = visible === 0;
      visibleProblems += visible;
    }
    entry.details.hidden = visibleProblems === 0;
    if (visibleProblems) visibleStages += 1;
    if (filtered && visibleProblems) entry.details.open = true;
    // Do not strand keyboard focus when a checkbox disappears under a filter.
    if (active?.matches('.roadmap-check input') && entry.details.contains(active) && active.closest('.roadmap-problem').hidden) {
      (entry.details.hidden ? filter : entry.summary).focus({ preventScroll: true });
    }
  }
  document.querySelector('#roadmap-empty').hidden = visibleStages !== 0;
  document.querySelector('#roadmap-count').textContent = `${completed.size} / ${ROADMAP_PROBLEMS.length}`;
  document.querySelector('#roadmap-progress').value = completed.size;
  continueButton.disabled = !ready || !next;
  document.querySelector('#roadmap-next').textContent = !ready ? 'Load your saved progress before checking off problems.'
    : next ? `Next up: ${next.title}. Easy and Medium first; Hards stay available for later.`
      : 'All 150 complete. Time for mixed, timed practice and spaced review.';
}
function build() {
  ROADMAP.forEach((stage, index) => {
    const details = element('details', 'roadmap-stage');
    details.id = 'roadmap-stage-' + stage.id;
    const summary = element('summary');
    const heading = element('div', 'roadmap-stage-heading');
    heading.append(element('h2', '', stage.title), element('p', '', stage.goal));
    const count = element('span', 'roadmap-stage-count');
    summary.append(element('span', 'roadmap-step', String(index + 1).padStart(2, '0')), heading, count);
    const body = element('div', 'roadmap-stage-body');
    body.append(element('p', 'roadmap-checkpoint', 'Checkpoint: ' + stage.checkpoint));
    const groups = stage.groups.map(data => {
      const node = element('section', 'roadmap-group');
      node.append(element('h3', '', data.title));
      for (const problem of data.problems) {
        const row = element('div', 'roadmap-problem');
        row.id = 'roadmap-problem-' + problem.id;
        const label = element('label', 'roadmap-check');
        const input = element('input');
        input.type = 'checkbox';
        input.disabled = true;
        input.setAttribute('aria-label', 'Completed: ' + problem.title);
        input.addEventListener('change', () => save(problem, input.checked));
        label.append(input);
        const link = element('a', '', problem.title);
        link.href = 'https://leetcode.com/problems/' + problem.id + '/';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const difficulty = element('span', 'roadmap-difficulty ' + problem.difficulty.toLowerCase(), problem.difficulty);
        row.append(label, link, difficulty);
        node.append(row);
        rows.set(problem.id, { node: row, input, stage: details });
      }
      body.append(node);
      return { node, data };
    });
    details.append(summary, body);
    stages.append(details);
    stageViews.push({ stage, details, summary, count, groups });
  });
  update();
}
async function load() {
  if (loading || pending.size) return;
  loading = true;
  stages.setAttribute('aria-busy', 'true');
  const startedAt = revision;
  if (!ready) say('Loading progress…');
  try {
    const result = await api();
    if (!Array.isArray(result)) throw new Error('Could not read roadmap progress. Please retry.');
    // A delayed refresh must not undo a checkbox clicked after that refresh began.
    if (revision !== startedAt) return;
    completed.clear();
    for (const item of result) if (rows.has(item.problem_id) && item.completed === 1) completed.add(item.problem_id);
    ready = true;
    say('Progress saved across devices');
    update();
  } catch (error) { say(error.message, true); }
  finally { loading = false; stages.setAttribute('aria-busy', 'false'); }
}
async function save(problem, checked) {
  if (!ready || pending.has(problem.id)) return;
  const previous = completed.has(problem.id);
  if (checked) completed.add(problem.id); else completed.delete(problem.id);
  pending.add(problem.id);
  revision += 1;
  say('Saving progress…');
  update();
  try {
    const result = await api('/' + problem.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: checked }) });
    if (result.problem_id !== problem.id || result.completed !== Number(checked)) throw new Error('Could not confirm the save. Please retry.');
    // Keep an earlier failure visible if another independent save finishes later.
    if (!status.classList.contains('error')) say(pending.size > 1 ? 'Saving progress…' : 'Progress saved across devices');
  } catch (error) {
    if (previous) completed.add(problem.id); else completed.delete(problem.id);
    say(error.message + ' Could not confirm this change. Reload progress or toggle it again.', true);
  } finally {
    pending.delete(problem.id);
    revision += 1;
    update();
  }
}
search.addEventListener('input', update);
filter.addEventListener('change', update);
retry.addEventListener('click', load);
continueButton.addEventListener('click', () => {
  const next = nextProblem();
  if (!next) return;
  search.value = '';
  filter.value = 'all';
  update();
  const row = rows.get(next.id);
  row.stage.open = true;
  row.node.scrollIntoView({ block: 'center', behavior: 'instant' });
  row.node.querySelector('a').focus({ preventScroll: true });
});
build();

function route() {
  if (!window.notesReady) return;
  const active = location.hash === '#/roadmap';
  document.querySelector('#roadmap-open').removeAttribute('aria-current');
  if (!active) {
    if (main.dataset.page === 'roadmap') window.showReport(false);
    return;
  }
  document.querySelector('#roadmap-open').setAttribute('aria-current', 'page');
  if (main.dataset.page !== 'roadmap') {
    window.showReport(false);
    main.dataset.page = 'roadmap';
  }
  load();
}
window.closeRoadmap = () => {
  if (main.dataset.page !== 'roadmap') return;
  document.querySelector('#roadmap-open').removeAttribute('aria-current');
  if (location.hash === '#/roadmap') history.pushState(null, '', location.pathname + location.search);
};
document.querySelector('#roadmap-close').addEventListener('click', () => window.showReport(false));
window.addEventListener('hashchange', route);
const bootRoute = window.routeBooks;
window.routeBooks = () => { bootRoute?.(); route(); };
if (window.notesReady) route();
const refresh = () => { if (main.dataset.page === 'roadmap' && document.visibilityState === 'visible') load(); };
window.addEventListener('focus', refresh);
window.addEventListener('online', refresh);
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 30000);
window.addEventListener('beforeunload', event => {
  if (pending.size) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && main.dataset.page === 'roadmap' && !event.isComposing && !event.defaultPrevented) {
    event.preventDefault();
    window.showReport(false);
    document.querySelector('#roadmap-open').focus();
  }
});
