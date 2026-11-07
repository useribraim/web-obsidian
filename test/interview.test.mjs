import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';
import { ROUND_SIZE, INTERVIEW_TOPICS, INTERVIEW_QUESTIONS, interviewQuestion, pickQuestions, gradeRound, mistakesMarkdown } from '../public/interview-data.js';
import { questionStudy } from '../public/interview-study.js';

function makeRound(topic = 'mixed', missed = 2) {
  const questionIds = pickQuestions(topic);
  return {
    id: crypto.randomUUID(), topic, questionIds, completedAt: '2026-10-21T12:34:56.000Z',
    answers: questionIds.map((id, i) => (interviewQuestion(id).answer + (i < missed ? 1 : 0)) % 4),
  };
}
function database(sqlite) {
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) ?? null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
    };
  } };
}

test('interview bank has forty unique, explained Python and C++ MCQs', () => {
  assert.deepEqual(INTERVIEW_TOPICS.map(topic => topic.id), ['mixed', 'python', 'cpp']);
  assert.equal(INTERVIEW_QUESTIONS.length, 40);
  assert.equal(new Set(INTERVIEW_QUESTIONS.map(item => item.id)).size, 40);
  assert.equal(new Set(INTERVIEW_QUESTIONS.map(item => item.prompt)).size, 40);
  for (const topic of INTERVIEW_TOPICS.filter(item => item.id !== 'mixed')) {
    assert.equal(INTERVIEW_QUESTIONS.filter(item => item.topic === topic.id).length, 20);
  }
  for (const item of INTERVIEW_QUESTIONS) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(INTERVIEW_TOPICS.some(topic => topic.id === item.topic));
    assert.equal(item.options.length, 4);
    assert.equal(new Set(item.options).size, 4);
    assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 4);
    assert.ok(item.explanation.length > 40);
    assert.ok(['fundamentals', 'intermediate'].includes(item.difficulty));
  }
});

test('each language and difficulty produces a complete valid round', () => {
  for (const topic of INTERVIEW_TOPICS) {
    for (const difficulty of ['all', 'fundamentals', 'intermediate']) {
      const ids = pickQuestions(topic.id, () => 0.5, difficulty);
      assert.equal(ids.length, ROUND_SIZE);
      assert.equal(new Set(ids).size, ROUND_SIZE);
      assert.ok(ids.every(id => difficulty === 'all' || interviewQuestion(id).difficulty === difficulty));
      assert.equal(gradeRound(ids, ids.map(id => interviewQuestion(id).answer), topic.id).score, ROUND_SIZE);
    }
  }
  assert.throws(() => pickQuestions('python', Math.random, 'invalid'));
});

test('round selection shuffles ten unique questions without mutating the bank', () => {
  const before = JSON.stringify(INTERVIEW_QUESTIONS);
  for (const topic of INTERVIEW_TOPICS) {
    const ids = pickQuestions(topic.id, () => 0);
    assert.equal(ids.length, ROUND_SIZE);
    assert.equal(new Set(ids).size, ROUND_SIZE);
    assert.ok(ids.every(id => topic.id === 'mixed' || interviewQuestion(id).topic === topic.id));
    assert.notDeepEqual(ids, pickQuestions(topic.id, () => 0.999));
  }
  assert.throws(() => pickQuestions('unknown'));
  assert.equal(JSON.stringify(INTERVIEW_QUESTIONS), before);
});

test('grading validates complete rounds and Markdown contains only missed questions', () => {
  const round = makeRound('python', 2);
  const result = gradeRound(round.questionIds, round.answers, round.topic);
  assert.equal(result.score, 8);
  assert.equal(result.mistakes.length, 2);
  const markdown = mistakesMarkdown(round);
  for (const item of result.mistakes) {
    assert.ok(markdown.includes(item.question.prompt));
    assert.ok(markdown.includes(item.question.options[item.selected]));
    assert.ok(markdown.includes(item.question.options[item.question.answer]));
    assert.ok(markdown.includes(item.question.explanation));
  }
  assert.ok(!markdown.includes(interviewQuestion(round.questionIds[2]).prompt));
  assert.equal((markdown.match(/^## Question /gm) || []).length, 2);
  assert.match(markdown, /Score: 8 \/ 10/);
  const perfect = makeRound('mixed', 0);
  assert.equal(gradeRound(perfect.questionIds, perfect.answers, perfect.topic).score, 10);
  assert.match(mistakesMarkdown(perfect), /No mistakes/);
  const invalid = [
    [[], [], 'mixed'], [round.questionIds, [], 'python'], [round.questionIds, round.answers, 'cpp'],
    [round.questionIds, round.answers, 'unknown'], [Array(10).fill(round.questionIds[0]), round.answers, 'python'],
    [['unknown', ...round.questionIds.slice(1)], round.answers, 'python'],
    [round.questionIds, [undefined, ...round.answers.slice(1)], 'python'],
    [round.questionIds, [4, ...round.answers.slice(1)], 'python'],
    [round.questionIds, [-1, ...round.answers.slice(1)], 'python'],
    [round.questionIds, ['1', ...round.answers.slice(1)], 'python'],
  ];
  for (const args of invalid) assert.throws(() => gradeRound(...args));
});

test('every question has a basics lesson and code example', () => {
  for (const item of INTERVIEW_QUESTIONS) {
    const study = questionStudy(item.id);
    assert.ok(study, item.id);
    assert.ok(study.title.length > 5);
    assert.ok(study.basics.length > 100);
    assert.ok(study.code.length > 30);
  }
});

test('unknown answers count as unlearned and export basics without undefined answers', () => {
  const round = makeRound('python', 0);
  round.answers[0] = null;
  const result = gradeRound(round.questionIds, round.answers, round.topic);
  assert.equal(result.score, 9);
  assert.equal(result.mistakes.length, 1);
  assert.equal(result.mistakes[0].selected, null);
  const markdown = mistakesMarkdown(round);
  assert.match(markdown, /Your answer: I don’t know/);
  assert.ok(markdown.includes(questionStudy(round.questionIds[0]).basics));
  assert.match(markdown, /```python/);
  assert.ok(!markdown.includes('undefined'));
  round.answers.fill(null);
  assert.equal(gradeRound(round.questionIds, round.answers, round.topic).score, 0);
});

test('interview API authenticates, grades, and saves retry-safe ordinary notes without overwriting edits', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { PASSWORD: 'interview-test-password', DB: database(sqlite) };
  const origin = 'https://interview.test';
  const path = '/api/interview/results';
  let cookie = '';
  const request = (url = path, method = 'POST', body, headers = {}) => worker.fetch(new Request(origin + url, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), env);
  try {
    const round = makeRound();
    assert.equal((await request(path, 'POST', round)).status, 401);
    const login = await request('/api/auth/login', 'POST', { password: env.PASSWORD });
    cookie = login.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await request(path, 'GET')).status, 405);
    assert.equal((await request(path, 'POST', round, { Origin: 'https://evil.test' })).status, 403);
    for (const body of ['{', 'null', '{}', { ...round, id: '../notes' }, { ...round, completedAt: 'yesterday' },
      { ...round, completedAt: '2026-02-30T12:34:56.000Z' }, { ...round, answers: [] }, { ...round, topic: 'unknown' }]) {
      assert.equal((await request(path, 'POST', body)).status, 400);
    }
    assert.equal((await request(path, 'POST', 'x'.repeat(8193))).status, 413);
    const response = await request(path, 'POST', { ...round, score: 10 }, { Origin: origin });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const result = await response.json();
    assert.equal(result.score, 8, 'Client-supplied scores are ignored');
    assert.equal(result.note.id, round.id);
    const note = await (await request('/api/notes/' + result.note.id, 'GET')).json();
    assert.equal(note.content, mistakesMarkdown(round));
    assert.equal(note.version, 1);
    assert.equal(note.deleted_at, null);
    assert.match(note.title, /Interview mistakes/);
    // Model an ambiguous failure: the response was lost, then the same result is retried concurrently.
    const repeats = await Promise.all([request(path, 'POST', round), request(path, 'POST', round)]);
    assert.ok(repeats.every(item => item.status === 200));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 1);
    assert.equal(sqlite.prepare('SELECT version FROM notes WHERE id = ?').get(round.id).version, 1);
    const perfect = await request(path, 'POST', makeRound('mixed', 0));
    assert.equal((await perfect.json()).note, null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 1);
    const collision = { ...makeRound('cpp'), id: round.id };
    assert.equal((await request(path, 'POST', collision)).status, 409);
    assert.equal(sqlite.prepare('SELECT content FROM notes WHERE id = ?').get(round.id).content, note.content);
    sqlite.prepare('UPDATE notes SET content = ?, version = 2 WHERE id = ?').run('My manual study notes', round.id);
    assert.equal((await request(path, 'POST', round)).status, 409);
    assert.equal(sqlite.prepare('SELECT content FROM notes WHERE id = ?').get(round.id).content, 'My manual study notes');
    sqlite.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run('2026-10-22', round.id);
    assert.equal((await request(path, 'POST', round)).status, 409);
    assert.equal(sqlite.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(round.id).deleted_at, '2026-10-22');
    const next = makeRound('python', 1);
    next.answers[0] = null;
    assert.equal((await request(path, 'POST', next)).status, 201);
    const unknownNote = sqlite.prepare('SELECT content FROM notes WHERE id = ?').get(next.id);
    assert.match(unknownNote.content, /Your answer: I don’t know/);
    assert.match(unknownNote.content, /### Basics:/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 2);
  } finally { sqlite.close(); }
});
