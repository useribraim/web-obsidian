import { ROADMAP_CATEGORIES, ROADMAP_PROBLEMS, ROADMAP_LANGUAGES, parseSolves, otherKey } from '/roadmap-data.js';

const $ = selector => document.querySelector(selector);
const form = $('#roadmap-form');
const text = $('#roadmap-text');
const status = $('#roadmap-status');
const unmatched = $('#roadmap-unmatched');
const defaultLanguage = $('#roadmap-default');
const open = new Set();
let entries = [];

for (const name of Object.keys(ROADMAP_LANGUAGES)) defaultLanguage.append(new Option(name, name));
try { defaultLanguage.value = localStorage.getItem('roadmap-language') || ''; } catch { /* storage may be blocked */ }
defaultLanguage.addEventListener('change', () => { try { localStorage.setItem('roadmap-language', defaultLanguage.value); } catch { /* storage may be blocked */ } });

function say(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function api(path = '', options) {
  const response = await fetch('/api/roadmap' + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not reach the roadmap. Please try again.');
  return result;
}
const el = (tag, content, className) => {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
};
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function describe(solves) {
  const counts = new Map();
  for (const solve of solves) counts.set(solve.language, (counts.get(solve.language) || 0) + 1);
  return [...counts].map(([language, count]) => `${count}× ${language || 'no language'}`).join(' · ');
}

function render() {
  const byKey = new Map();
  for (const entry of entries) byKey.set(entry.key, [...(byKey.get(entry.key) || []), entry]);

  const solvedCount = ROADMAP_PROBLEMS.filter(problem => byKey.has(problem.key)).length;
  const total = ROADMAP_PROBLEMS.length;
  $('#roadmap-total').textContent = `${solvedCount} / ${total} solved · ${entries.length} ${entries.length === 1 ? 'solve' : 'solves'}`;
  $('#roadmap-bar-fill').style.width = `${(solvedCount / total) * 100}%`;
  $('.roadmap-bar').setAttribute('aria-valuenow', String(solvedCount));

  const languageTotals = new Map();
  for (const entry of entries) if (entry.language) languageTotals.set(entry.language, (languageTotals.get(entry.language) || 0) + 1);
  const languages = $('#roadmap-languages');
  languages.replaceChildren();
  [...languageTotals].sort((a, b) => b[1] - a[1]).forEach(([language, count], index) => {
    if (index) languages.append(' · ');
    languages.append(el('b', count), ` ${language}`);
  });

  const categories = $('#roadmap-categories');
  categories.replaceChildren();
  const groups = ROADMAP_CATEGORIES.map(([category, names]) => ({ category, problems: ROADMAP_PROBLEMS.filter(problem => problem.category === category) }));
  const knownKeys = new Set(ROADMAP_PROBLEMS.map(problem => problem.key));
  const extras = new Map();
  for (const entry of entries) if (!knownKeys.has(entry.key)) extras.set(entry.key, { key: entry.key, name: entry.title });
  if (extras.size) groups.push({ category: 'Other problems', problems: [...extras.values()], extra: true });

  for (const group of groups) {
    const solved = group.problems.filter(problem => byKey.has(problem.key)).length;
    const details = el('details', undefined, 'roadmap-category');
    if (!group.extra && solved === group.problems.length) details.classList.add('done');
    details.open = open.has(group.category);
    details.addEventListener('toggle', () => { details.open ? open.add(group.category) : open.delete(group.category); });

    const summary = el('summary');
    const mini = el('span', undefined, 'mini');
    const fill = el('i');
    fill.style.width = group.extra ? '0' : `${(solved / group.problems.length) * 100}%`;
    mini.append(fill);
    summary.append(el('span', group.category), group.extra ? el('span') : mini, el('span', group.extra ? String(solved) : `${solved}/${group.problems.length}`, 'count'));
    details.append(summary);

    const list = el('ul', undefined, 'roadmap-problems');
    for (const problem of group.problems) {
      const solves = byKey.get(problem.key) || [];
      const item = el('li');
      if (solves.length) item.classList.add('solved');
      item.append(el('span', problem.name));
      if (solves.length) {
        const meta = el('span', undefined, 'meta');
        meta.append(describe(solves) + ' ');
        const undo = el('button', '×');
        undo.type = 'button';
        undo.title = 'Remove the latest solve';
        undo.setAttribute('aria-label', `Remove the latest solve of ${problem.name}`);
        undo.addEventListener('click', () => remove(solves[solves.length - 1]));
        meta.append(undo);
        item.append(meta);
      }
      list.append(item);
    }
    details.append(list);
    categories.append(details);
  }
}

async function remove(entry) {
  try {
    await api('/' + entry.id, { method: 'DELETE' });
    entries = entries.filter(item => item.id !== entry.id);
    render();
    say(`Removed one solve of ${entry.title}.`);
  } catch (error) { say(error.message, true); }
}

async function save(solves, extra = []) {
  const date = today();
  const batch = solves.map(solve => ({ key: solve.key, title: solve.name, language: solve.language, date }))
    .concat(extra.map(title => ({ key: otherKey(title), title, language: defaultLanguage.value, date })));
  if (!batch.length) return;
  const button = $('#roadmap-add');
  button.disabled = true;
  try {
    const added = await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: batch }) });
    entries = entries.concat(added);
    for (const solve of solves) { open.add(solve.category); }
    text.value = '';
    unmatched.hidden = true;
    render();
    const message = `Added ${added.length} ${added.length === 1 ? 'solve' : 'solves'}. `;
    status.classList.remove('error');
    status.replaceChildren(message);
    const undo = el('button', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', async () => {
      try {
        await Promise.all(added.map(entry => api('/' + entry.id, { method: 'DELETE' })));
        const ids = new Set(added.map(entry => entry.id));
        entries = entries.filter(entry => !ids.has(entry.id));
        render();
        say('Undone.');
      } catch (error) { say(error.message, true); }
    });
    status.append(undo);
  } catch (error) { say(error.message, true); } finally { button.disabled = false; }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const { solves, unmatched: misses } = parseSolves(text.value, defaultLanguage.value);
  if (!solves.length && !misses.length) { say('Type at least one problem.', true); return; }
  if (!misses.length) { save(solves); return; }
  unmatched.replaceChildren(el('p', `${misses.length === 1 ? 'This line is' : 'These lines are'} not in the NeetCode 150.`));
  const list = el('ul');
  for (const miss of misses) list.append(el('li', miss));
  unmatched.append(list);
  const keep = el('button', 'Add as other problems');
  keep.type = 'button';
  keep.addEventListener('click', () => save(solves, misses));
  const skip = el('button', solves.length ? 'Add only the matches' : 'Cancel');
  skip.type = 'button';
  skip.addEventListener('click', () => { if (solves.length) save(solves); else unmatched.hidden = true; });
  unmatched.append(keep, skip);
  unmatched.hidden = false;
  say('');
});
text.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
});

try {
  entries = await api();
  render();
} catch (error) {
  $('#roadmap-total').textContent = '';
  say(error.message, true);
}
