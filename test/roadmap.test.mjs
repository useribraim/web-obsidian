import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ROADMAP_CATEGORIES, ROADMAP_PROBLEMS, parseSolves, parseLine, findProblem } from '../public/roadmap-data.js';
import { roadmapResponse } from '../roadmap-api.js';

function database(sqlite) {
  const wrap = sql => {
    const statement = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
    };
  };
  return { prepare: wrap, async batch(statements) { for (const statement of statements) await statement.run(); return []; } };
}
const request = (method, path, body) => new Request('https://obsidian.ibraim.ie' + path, {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const call = (env, method, path, body) => roadmapResponse(request(method, path, body), env, new URL('https://obsidian.ibraim.ie' + path));

test('the roadmap holds the NeetCode 150 in eighteen categories without duplicates', () => {
  assert.equal(ROADMAP_CATEGORIES.length, 18);
  assert.equal(ROADMAP_PROBLEMS.length, 150);
  assert.equal(new Set(ROADMAP_PROBLEMS.map(problem => problem.key)).size, 150);
});

test('lines are matched to problems with and without a language', () => {
  const { solves, unmatched } = parseSolves([
    'Two Sum python', '- 3sum (c++)', '1. lru cache - cpp', 'house robber 2 in py',
    'https://leetcode.com/problems/valid-anagram/ java', 'python: group anagrams', 'valid parentheses', 'two sum',
    'not a real problem',
  ].join('\n'), 'Rust');
  assert.deepEqual(solves.map(solve => [solve.name, solve.language]), [
    ['Two Sum', 'Python'], ['3Sum', 'C++'], ['LRU Cache', 'C++'], ['House Robber II', 'Python'],
    ['Valid Anagram', 'Java'], ['Group Anagrams', 'Python'], ['Valid Parentheses', 'Rust'], ['Two Sum', 'Rust'],
  ]);
  assert.deepEqual(unmatched, ['not a real problem']);
});

test('numbered variants, misspellings, and several languages are understood', () => {
  assert.equal(findProblem('two sum ii').name, 'Two Sum II Input Array Is Sorted');
  assert.equal(findProblem('two sum').name, 'Two Sum');
  assert.equal(findProblem('subsets 2').name, 'Subsets II');
  assert.equal(findProblem('longest consecutve sequence').name, 'Longest Consecutive Sequence');
  assert.equal(findProblem('kth'), null);
  assert.deepEqual(parseSolves('merge intervals python cpp').solves.map(solve => solve.language), ['Python', 'C++']);
  assert.deepEqual(parseLine('Binary Search (python, c++)').languages, ['Python', 'C++']);
});

test('the roadmap API stores, lists, validates, and removes solves', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0009_add_roadmap.sql', import.meta.url), 'utf8'));
  const env = { DB: database(sqlite) };
  const entry = { key: 'twosum', title: 'Two Sum', language: 'Python', date: '2026-11-03' };

  const created = await call(env, 'POST', '/api/roadmap', { entries: [entry, { ...entry, language: '' }] });
  assert.equal(created.status, 201);
  const rows = await created.json();
  assert.equal(rows.length, 2);
  assert.equal((await (await call(env, 'GET', '/api/roadmap')).json()).length, 2);

  for (const bad of [
    { ...entry, key: 'nonsense' }, { ...entry, language: 'Klingon' }, { ...entry, date: '2026-13-40' }, { ...entry, title: '' },
  ]) assert.equal((await call(env, 'POST', '/api/roadmap', { entries: [bad] })).status, 400);
  assert.equal((await call(env, 'POST', '/api/roadmap', { entries: [] })).status, 400);
  assert.equal((await call(env, 'POST', '/api/roadmap', { entries: [{ ...entry, key: 'other:sometask', title: 'Some Task' }] })).status, 201);

  const foreign = new Request('https://obsidian.ibraim.ie/api/roadmap', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  assert.equal((await roadmapResponse(foreign, env, new URL(foreign.url))).status, 403);

  assert.equal((await call(env, 'DELETE', '/api/roadmap/' + rows[0].id)).status, 200);
  assert.equal((await (await call(env, 'GET', '/api/roadmap')).json()).length, 2);
  assert.equal(await call(env, 'GET', '/api/other'), null);
});
