import { ROUND_SIZE, INTERVIEW_TOPICS, INTERVIEW_QUESTIONS, interviewTopic, interviewQuestion, pickQuestions, gradeRound, mistakesMarkdown } from './interview-data.js';
import { questionStudy } from './interview-study.js';

const $ = selector => document.querySelector(selector);
const main = $('#app-main');
const standalone = main.dataset.standalone === 'prep';
const storageKey = 'interviewRound:v1';
let round = null;
let note = null;
let saving = false;
let saved = false;
let downloaded = false;
let drill = null;
const studyKey = 'interviewStudy:v1';
let studyIds = [];
let studyStorageWarning = '';
try {
  const stored = JSON.parse(localStorage.getItem(studyKey) || '[]');
  if (!Array.isArray(stored)) throw new Error('Invalid study list');
  studyIds = [...new Set(stored.filter(id => interviewQuestion(id)))];
} catch { studyStorageWarning = 'Your study list could not be restored. New items will stay here for this visit.'; }
const studyList = element('details', 'interview-study-list');
$('#interview-recovery').after(studyList);
const unknownButton = element('button', 'tool interview-unknown', 'I don’t know — study later');
unknownButton.type = 'button';
$('#interview-check').after(unknownButton);

function lessonDetails(item) {
  const study = questionStudy(item.id);
  const details = element('details', 'interview-basics');
  details.append(element('summary', '', `Study the basics: ${study.title}`), element('p', '', study.basics));
  const pre = element('pre');
  pre.append(element('code', '', study.code));
  details.append(pre, element('p', '', `Connect it to this question: ${item.explanation}`));
  return details;
}
function renderStudyList() {
  studyList.replaceChildren(element('summary', '', `Study later (${studyIds.length})`));
  studyList.append(element('p', '', 'Questions you marked “I don’t know”. Saved in this browser, not synced across devices. Study first, then try again without changing your round score.'));
  if (studyStorageWarning) studyList.append(element('p', 'interview-warning', studyStorageWarning));
  if (!studyIds.length) studyList.append(element('p', '', 'Nothing waiting. Use “I don’t know” during a round to add a question.'));
  for (const id of studyIds) {
    const item = interviewQuestion(id);
    const card = element('article', 'interview-card interview-study-item');
    card.append(element('span', 'interview-eyebrow', interviewTopic(item.topic).title), element('h3', '', item.prompt), lessonDetails(item));
    const practice = element('div', 'interview-study-practice');
    const retry = element('button', 'tool', 'Try this question again');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      practice.replaceChildren(element('p', '', 'Choose an answer. This is practice, not a scored round.'));
      const choices = element('div', 'interview-drill-options');
      item.options.forEach((text, index) => {
        const option = element('button', 'tool interview-option', text);
        option.type = 'button';
        option.addEventListener('click', () => {
          for (const button of choices.children) button.disabled = true;
          choices.children[item.answer].classList.add('correct');
          if (index !== item.answer) option.classList.add('incorrect');
          const feedback = element('p', '', `${index === item.answer ? 'That’s right.' : 'Not yet.'} ${item.explanation}`);
          feedback.setAttribute('role', 'status');
          practice.append(feedback);
        });
        choices.append(option);
      });
      practice.append(choices);
    });
    const understood = element('button', 'tool', 'Mark understood');
    understood.type = 'button';
    understood.addEventListener('click', () => {
      studyIds = studyIds.filter(value => value !== id);
      persistStudy();
      renderStudyList();
      studyList.querySelector('summary').focus();
    });
    card.append(retry, understood, practice);
    studyList.append(card);
  }
}
function persistStudy() {
  try { localStorage.setItem(studyKey, JSON.stringify(studyIds)); studyStorageWarning = ''; }
  catch { studyStorageWarning = 'Browser storage is unavailable. This study list will not survive closing or reloading the page; download your round notes to keep the basics.'; }
}
function flagForStudy(id) {
  if (!studyIds.includes(id)) studyIds.push(id);
  persistStudy();
  renderStudyList();
}
renderStudyList();
unknownButton.addEventListener('click', () => {
  if (!round || round.answers.length > round.index) return;
  round.answers.push(null);
  flagForStudy(round.questionIds[round.index]);
  persist();
  renderQuestion();
  $('#interview-next').focus({ preventScroll: true });
});

// Add shared study controls to both the standalone site and notebook view.
const difficultyLabel = element('label', '', 'Difficulty');
difficultyLabel.htmlFor = 'interview-difficulty';
const difficultySelect = element('select');
difficultySelect.id = 'interview-difficulty';
for (const [value, title] of [['all', 'All levels'], ['fundamentals', 'Fundamentals'], ['intermediate', 'Intermediate']]) {
  difficultySelect.append(new Option(title, value));
}
$('#interview-topic').after(difficultyLabel, difficultySelect);
const retryMistakes = element('button', 'tool', 'Practice missed questions →');
retryMistakes.type = 'button';
retryMistakes.hidden = true;
$('.interview-result-actions').append(retryMistakes);
const drillPanel = element('section', 'interview-card interview-drill');
drillPanel.setAttribute('aria-label', 'Missed-question practice');
drillPanel.hidden = true;
$('#interview-mistakes').before(drillPanel);
const bankCopy = $('#interview-setup .interview-bank');
bankCopy.textContent = `${INTERVIEW_QUESTIONS.length} explained Python 3 and C++17 questions. Choose a language and level, then revisit what you missed.`;

function renderDrill(focus = true) {
  drillPanel.hidden = !drill;
  drillPanel.replaceChildren();
  if (!drill) return;
  const heading = element('h2', '', drill.index < drill.ids.length
    ? `Retry ${drill.index + 1} of ${drill.ids.length}` : 'Retry complete');
  heading.tabIndex = -1;
  drillPanel.append(heading);
  if (drill.index === drill.ids.length) {
    drillPanel.append(element('p', '', `${drill.correct} / ${drill.ids.length} correct on this retry. Your original round and saved note are unchanged.`));
    const close = element('button', 'tool', 'Close practice');
    close.type = 'button';
    close.addEventListener('click', () => { drill = null; renderDrill(false); retryMistakes.focus(); });
    drillPanel.append(close);
  } else {
    const item = interviewQuestion(drill.ids[drill.index]);
    const form = element('form');
    const fieldset = element('fieldset');
    const legend = element('legend', '', item.prompt);
    fieldset.append(legend);
    const choices = element('div', 'interview-drill-options');
    item.options.forEach((text, index) => {
      const label = element('label', 'interview-option');
      const input = element('input');
      input.type = 'radio';
      input.name = 'retry-answer';
      input.value = String(index);
      input.required = true;
      input.disabled = drill.selected !== null;
      input.checked = drill.selected === index;
      if (drill.selected !== null && index === item.answer) label.classList.add('correct');
      else if (drill.selected === index) label.classList.add('incorrect');
      label.append(input, element('span', '', text));
      choices.append(label);
    });
    fieldset.append(choices);
    form.append(fieldset);
    if (drill.selected !== null) {
      const feedback = element('div', 'interview-feedback');
      feedback.classList.toggle('correct', drill.selected === item.answer);
      feedback.append(element('strong', '', drill.selected === item.answer ? 'That’s right.' : 'Keep this one on your review list.'), element('p', '', item.explanation));
      if (drill.selected === -1) feedback.append(lessonDetails(item));
      form.append(feedback);
    }
    const action = element('button', 'tool interview-primary', drill.selected === null ? 'Check retry' : 'Continue →');
    action.type = 'submit';
    action.disabled = drill.selected === null;
    choices.addEventListener('change', () => { action.disabled = false; });
    form.append(action);
    if (drill.selected === null) {
      const unknown = element('button', 'tool interview-unknown', 'I don’t know — study later');
      unknown.type = 'button';
      unknown.addEventListener('click', () => {
        flagForStudy(item.id);
        drill.selected = -1;
        renderDrill();
      });
      form.append(unknown);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (drill.selected === null) {
        const selected = form.querySelector('input:checked');
        if (!selected) return;
        drill.selected = Number(selected.value);
        if (drill.selected === item.answer) drill.correct += 1;
      } else {
        drill.index += 1;
        drill.selected = null;
      }
      renderDrill();
    });
    drillPanel.append(form);
  }
  if (focus) heading.focus();
}
retryMistakes.addEventListener('click', () => {
  if (!round?.completedAt) return;
  const ids = gradeRound(round.questionIds, round.answers, round.topic).mistakes.map(item => item.question.id);
  if (!ids.length) return;
  drill = { ids, index: 0, selected: null, correct: 0 };
  renderDrill();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function recovery(text) {
  $('#interview-recovery').textContent = text;
  $('#interview-recovery').hidden = !text;
}
function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ ...round, note, saved })); }
  catch { recovery('This browser cannot keep this round through a reload. Finish it before closing this page, and download your mistakes if saving fails.'); }
}
function restore() {
  try {
    const value = sessionStorage.getItem(storageKey);
    if (!value) return;
    const data = JSON.parse(value);
    if (!data || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.id)
      || !Array.isArray(data.answers) || !Number.isInteger(data.index) || data.index < 0 || data.index >= ROUND_SIZE
      || ![data.index, data.index + 1].includes(data.answers.length)) throw new Error('Invalid round');
    // Validate every question, the topic, and all committed answers, even for an unfinished round.
    gradeRound(data.questionIds, [...data.answers, ...Array(ROUND_SIZE - data.answers.length).fill(0)], data.topic);
    if (data.completedAt && (data.answers.length !== ROUND_SIZE || data.index !== ROUND_SIZE - 1
      || new Date(data.completedAt).toISOString() !== data.completedAt)) throw new Error('Invalid round');
    round = { id: data.id, topic: data.topic, questionIds: data.questionIds, answers: data.answers, index: data.index, completedAt: data.completedAt || null };
    note = data.note?.id === data.id && typeof data.note.title === 'string' ? data.note : null;
    saved = Boolean(note && data.saved);
  } catch { recovery('The previous round could not be restored. Start a new one; any notes already saved are still in your notebook.'); }
}
function updateActions() {
  $('#interview-save-retry').hidden = saving || saved || !round || !gradeRound(round.questionIds, round.answers, round.topic).mistakes.length;
  $('#interview-note').hidden = !note;
  // Do not silently discard an unsaved result. A local download also lets the user move on.
  $('#interview-again').disabled = saving || (!saved && !downloaded && gradeRound(round.questionIds, round.answers, round.topic).mistakes.length > 0);
}
function saveStatus(text, error = false) {
  $('#interview-save-status').textContent = text;
  $('#interview-save-status').classList.toggle('error', error);
}
async function saveResults() {
  if (saving || saved || !round?.completedAt) return;
  const result = gradeRound(round.questionIds, round.answers, round.topic);
  if (!result.mistakes.length) {
    saved = true;
    saveStatus('No wrong answers, so no mistakes note was created.');
    updateActions();
    return;
  }
  saving = true;
  saveStatus('Saving your mistakes to a new notebook note…');
  updateActions();
  try {
    const response = await fetch('/api/interview/results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ id: round.id, topic: round.topic, questionIds: round.questionIds, answers: round.answers, completedAt: round.completedAt }),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('Could not read the save response. Please retry.'); }
    if (!response.ok) throw new Error(data.error || 'Could not save your mistakes. Please retry.');
    if (data.note?.id !== round.id || typeof data.note.title !== 'string' || data.score !== result.score) throw new Error('Could not confirm the save. Please retry.');
    note = data.note;
    saved = true;
    persist();
    document.dispatchEvent(new CustomEvent('interview-note-saved', { detail: note }));
    saveStatus('Saved in your notebook. Open it on any signed-in device.');
  } catch (error) {
    saveStatus(error.message + ' Your answers are still here; retry or download a copy before starting a new round.', true);
  } finally { saving = false; updateActions(); }
}
function renderQuestion(focus = false) {
  const item = interviewQuestion(round.questionIds[round.index]);
  const answered = round.answers.length > round.index;
  const selected = round.answers[round.index];
  $('#interview-round-topic').textContent = `${interviewTopic(item.topic).title} · ${item.difficulty === 'intermediate' ? 'Intermediate' : 'Fundamentals'}`;
  $('#interview-step').textContent = `Question ${round.index + 1} of ${ROUND_SIZE}`;
  $('#interview-progress').value = round.answers.length;
  $('#interview-question').textContent = item.prompt;
  const options = $('#interview-options');
  options.replaceChildren();
  item.options.forEach((text, index) => {
    const label = element('label', 'interview-option');
    const input = element('input');
    input.type = 'radio';
    input.name = 'interview-answer';
    input.value = String(index);
    input.required = true;
    input.disabled = answered;
    input.checked = answered && index === selected;
    const copy = element('span', 'interview-option-copy');
    copy.append(element('span', '', text));
    if (answered && index === item.answer) {
      label.classList.add('correct');
      copy.append(element('small', '', 'Correct answer'));
    } else if (answered && index === selected) {
      label.classList.add('incorrect');
      copy.append(element('small', '', 'Your answer'));
    }
    label.append(input, element('span', 'interview-letter', String.fromCharCode(65 + index)), copy);
    options.append(label);
  });
  $('#interview-check').hidden = answered;
  unknownButton.hidden = answered;
  $('#interview-check').disabled = true;
  $('#interview-next').hidden = !answered;
  $('#interview-next').textContent = round.index === ROUND_SIZE - 1 ? 'See results →' : 'Next question →';
  const feedback = $('#interview-feedback');
  feedback.hidden = !answered;
  feedback.replaceChildren();
  if (answered) {
    feedback.classList.toggle('correct', selected === item.answer);
    feedback.append(element('strong', '', selected === null ? 'Saved to Study later. No need to guess.' : selected === item.answer ? 'That’s right.' : 'One to revisit.'), element('p', '', item.explanation));
    if (selected === null) feedback.append(lessonDetails(item));
  }
  if (focus) $('#interview-question').focus({ preventScroll: true });
}
function renderResults(focus = false) {
  const result = gradeRound(round.questionIds, round.answers, round.topic);
  $('#interview-score').textContent = `${result.score} / ${result.total} correct`;
  $('#interview-result-message').textContent = result.mistakes.length
    ? `${result.mistakes.length} ${result.mistakes.length === 1 ? 'concept' : 'concepts'} to revisit. A useful starting point for your next study session.`
    : 'A clean round. Try another topic and keep the momentum going.';
  $('#interview-download').hidden = !result.mistakes.length;
  retryMistakes.hidden = !result.mistakes.length;
  $('#interview-review-heading').hidden = !result.mistakes.length;
  const review = $('#interview-mistakes');
  review.replaceChildren();
  result.mistakes.forEach(({ question: item, selected }, index) => {
    const card = element('article', 'interview-card interview-mistake');
    card.append(element('span', 'interview-eyebrow', interviewTopic(item.topic).title),
      element('h3', '', `${index + 1}. ${item.prompt}`),
      element('p', 'interview-wrong-answer', `Your answer: ${selected === null ? 'I don’t know — study later' : item.options[selected]}`),
      element('p', 'interview-right-answer', `Correct answer: ${item.options[item.answer]}`),
      element('p', 'interview-explanation', item.explanation));
    card.append(lessonDetails(item));
    review.append(card);
  });
  if (saved) saveStatus(note ? 'Saved in your notebook. Open it on any signed-in device.' : 'No wrong answers, so no mistakes note was created.');
  updateActions();
  if (focus) $('#interview-score').focus({ preventScroll: true });
  saveResults();
}
function render(focus = false) {
  $('#interview-setup').hidden = Boolean(round);
  $('#interview-round').hidden = !round || Boolean(round.completedAt);
  $('#interview-results').hidden = !round?.completedAt;
  if (round?.completedAt) renderResults(focus);
  else if (round) renderQuestion(focus);
}
for (const topic of INTERVIEW_TOPICS) $('#interview-topic').append(new Option(topic.title, topic.id));
$('#interview-start').addEventListener('click', () => {
  const topic = $('#interview-topic').value;
  round = { id: crypto.randomUUID(), topic, questionIds: pickQuestions(topic, Math.random, difficultySelect.value), answers: [], index: 0, completedAt: null };
  drill = null;
  renderDrill(false);
  note = null;
  saved = false;
  downloaded = false;
  recovery('');
  persist();
  render(true);
});
$('#interview-options').addEventListener('change', () => { $('#interview-check').disabled = false; });
$('#interview-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!round || round.answers.length > round.index) return;
  const selected = $('#interview-options input:checked');
  if (!selected) return;
  round.answers.push(Number(selected.value));
  persist();
  renderQuestion();
  $('#interview-next').focus({ preventScroll: true });
});
$('#interview-next').addEventListener('click', () => {
  if (!round || round.answers.length !== round.index + 1) return;
  if (round.index === ROUND_SIZE - 1) round.completedAt = new Date().toISOString();
  else round.index += 1;
  persist();
  render(true);
  $('#interview-view').scrollTo({ top: 0 });
});
$('#interview-save-retry').addEventListener('click', saveResults);
$('#interview-note').addEventListener('click', () => {
  if (!note) return;
  if (standalone) window.open('https://obsidian.ibraim.ie', '_blank', 'noopener');
  else window.openNote(note.id, { active: true });
});
$('#interview-download').addEventListener('click', () => {
  if (!round?.completedAt) return;
  const url = URL.createObjectURL(new Blob([mistakesMarkdown(round)], { type: 'text/markdown;charset=utf-8' }));
  const link = element('a');
  link.href = url;
  link.download = `interview-mistakes-${round.completedAt.slice(0, 10)}-${round.id.slice(0, 8)}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  downloaded = true;
  updateActions();
});
$('#interview-again').addEventListener('click', () => {
  if ($('#interview-again').disabled) return;
  $('#interview-topic').value = round.topic;
  round = null;
  drill = null;
  renderDrill(false);
  note = null;
  saved = false;
  downloaded = false;
  try { sessionStorage.removeItem(storageKey); } catch {}
  render();
  $('#interview-topic').focus();
  $('#interview-view').scrollTo({ top: 0 });
});

let restored = false;
function route() {
  if (standalone) {
    if (!restored) { restore(); restored = true; }
    render();
    return;
  }
  if (!window.notesReady) return;
  const active = location.hash === '#/interview';
  $('#interview-open').removeAttribute('aria-current');
  if (!active) {
    if (main.dataset.page === 'interview') window.showReport(false);
    return;
  }
  if (main.dataset.page !== 'interview') {
    window.showReport(false);
    main.dataset.page = 'interview';
  }
  $('#interview-open').setAttribute('aria-current', 'page');
  if (!restored) { restore(); restored = true; }
  render();
}
window.closeInterview = () => {
  if (main.dataset.page !== 'interview') return;
  $('#interview-open').removeAttribute('aria-current');
  if (location.hash === '#/interview') history.pushState(null, '', location.pathname + location.search);
};
$('#interview-close').addEventListener('click', () => {
  if (standalone) location.href = 'https://obsidian.ibraim.ie';
  else window.showReport(false);
});
window.addEventListener('hashchange', route);
const bootRoute = window.routeBooks;
window.routeBooks = () => { bootRoute?.(); route(); };
if (standalone || window.notesReady) route();
document.addEventListener('keydown', event => {
  if (!standalone && event.key === 'Escape' && main.dataset.page === 'interview' && !event.isComposing && !event.defaultPrevented) {
    event.preventDefault();
    window.showReport(false);
    $('#interview-open').focus();
  }
});
