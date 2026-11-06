import { STAGES, OPTIONAL_STAGES, EXTENSIONS } from './stages.js';

const PROGRESS_KEY = 'buslab.progress.v1';
const STAGE_KEY = 'buslab.stage.v1';

const $ = selector => document.querySelector(selector);
const list = $('#stage-list');
const article = $('#stage');
const frame = $('#frame');
const progress = $('#progress');
const progressText = $('#progress-text');
const reload = $('#reload');
const reset = $('#reset');

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
  },
};

const done = new Set(store.get(PROGRESS_KEY, []));
const extras = { id: 'extensions', title: 'Keep going' };
const order = [...STAGES, ...OPTIONAL_STAGES, extras];
let current = order.some(stage => stage.id === store.get(STAGE_KEY, ''))
  ? store.get(STAGE_KEY, '')
  : STAGES[0].id;

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
};

function saveProgress() {
  store.set(PROGRESS_KEY, [...done]);
  progress.value = STAGES.filter(stage => done.has(stage.id)).length;
  progressText.textContent = `${progress.value} / ${STAGES.length}`;
}

function renderRail() {
  list.replaceChildren();
  const addDivider = text => list.append(el('p', { class: 'rail-divider', text }));
  const addItem = (stage, index, optional, tickable = true) => {
    const tick = tickable
      ? el('input', { type: 'checkbox', 'aria-label': `Mark ${stage.title} done` })
      : el('span', { 'aria-hidden': 'true' });
    if (tickable) {
      tick.checked = done.has(stage.id);
      tick.addEventListener('click', event => event.stopPropagation());
      tick.addEventListener('change', event => {
        event.stopPropagation();
        if (tick.checked) done.add(stage.id); else done.delete(stage.id);
        saveProgress();
      });
    }

    const title = el('button', { class: 'rail-title', type: 'button', text: stage.title });
    const row = el('div', { class: `rail-item${optional ? ' optional' : ''}`, 'data-id': stage.id },
      el('span', { class: 'tick' }, tick),
      el('span', { class: 'num', text: optional ? '' : String(index) }),
      title,
    );
    row.addEventListener('click', () => select(stage.id));
    list.append(row);
  };

  STAGES.forEach((stage, index) => addItem(stage, index, false));
  addDivider('Optional');
  OPTIONAL_STAGES.forEach(stage => addItem(stage, null, true));
  addDivider('Keep going');
  addItem(extras, null, true, false);

  for (const row of list.children) {
    if (row.dataset?.id) row.setAttribute('aria-current', String(row.dataset.id === current));
  }
}

function section(title, ...children) {
  return [el('h3', { text: title }), ...children];
}

function renderStage(stage, index, optional = false) {
  const head = el('div', { class: 'stage-head' },
    el('span', { class: 'kicker', text: optional ? 'Optional' : `Stage ${index}` }),
  );
  const title = el('h2', { text: stage.title });
  const goal = el('p', { class: 'goal', text: stage.goal });

  const learn = el('ul', { class: 'chips' }, ...(stage.learn || []).map(item => el('li', { text: item })));
  const tasks = el('ol', {}, ...(stage.tasks || []).map(item => el('li', { text: item })));
  const acceptance = el('ul', { class: 'done' }, ...(stage.done || []).map(item => el('li', { text: item })));

  const hint = el('details', {},
    el('summary', { text: 'Stuck? Open the hint' }),
    el('div', { class: 'body' }, el('p', { text: stage.hint || 'No hint for this one. Read the code you already have.' })),
  );

  const nodes = [head, title, goal, ...section('You will learn', learn), ...section('Tasks', tasks), ...section('Done when', acceptance), hint];

  if (stage.snippet) {
    nodes.push(el('details', {},
      el('summary', { text: 'Reference: the shape of the solution' }),
      el('div', { class: 'body' },
        el('pre', {}, el('code', { text: stage.snippet })),
        el('p', { class: 'note' },
          'The finished build is at ',
          el('a', { href: '/reference/final/', target: '_blank', rel: 'noopener', text: '/reference/final/' }),
          '. Open it to orient yourself; do not copy it wholesale.',
        ),
      ),
    ));
  }

  const index0 = order.findIndex(item => item.id === stage.id);
  const previous = order[index0 - 1];
  const next = order[index0 + 1];
  const back = el('button', { type: 'button', text: previous ? `← ${previous.title}` : '← Start' });
  const forward = el('button', { type: 'button', class: 'primary', text: next ? `${next.title} →` : 'Finished' });
  back.disabled = !previous;
  forward.disabled = !next;
  back.addEventListener('click', () => previous && select(previous.id));
  forward.addEventListener('click', () => next && select(next.id));
  nodes.push(el('div', { class: 'next' }, back, forward));

  return nodes;
}

function renderExtensions() {
  const items = EXTENSIONS.map(item => el('details', {},
    el('summary', { text: item.title }),
    el('div', { class: 'body' }, el('p', { text: item.detail })),
  ));
  return [
    el('div', { class: 'stage-head' }, el('span', { class: 'kicker', text: 'Keep going' })),
    el('h2', { text: 'You have a map. Now make it yours.' }),
    el('p', { class: 'goal', text: 'The eight stages teach the language. These are the features that make the map worth opening every day, in rough order of difficulty. Each one is a spec, an acceptance list, and a commit.' }),
    el('h3', { text: 'Optional stages' }),
    el('ul', { class: 'done' }, ...OPTIONAL_STAGES.map(stage => el('li', { text: `${stage.title} — ${stage.goal}` }))),
    el('h3', { text: 'Extensions' }),
    ...items,
  ];
}

function select(id) {
  current = id;
  store.set(STAGE_KEY, id);
  renderRail();
  const index = STAGES.findIndex(stage => stage.id === id);
  const optional = OPTIONAL_STAGES.findIndex(stage => stage.id === id);
  const nodes = id === extras.id
    ? renderExtensions()
    : index >= 0
      ? renderStage(STAGES[index], index)
      : renderStage(OPTIONAL_STAGES[optional], null, true);
  article.replaceChildren(...nodes);
  article.scrollTop = 0;
  document.title = `${order.find(stage => stage.id === id)?.title || 'Bus lab'} — Bus lab`;
}

reload.addEventListener('click', () => {
  try { frame.contentWindow.location.reload(); }
  catch { frame.src = frame.src; }
});

reset.addEventListener('click', () => {
  done.clear();
  saveProgress();
  renderRail();
});

document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea') || event.metaKey || event.ctrlKey) return;
  const index = order.findIndex(stage => stage.id === current);
  if (event.key === '[' && index > 0) select(order[index - 1].id);
  if (event.key === ']' && index < order.length - 1) select(order[index + 1].id);
});

saveProgress();
select(current);
