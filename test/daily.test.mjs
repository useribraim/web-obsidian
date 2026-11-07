import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dailyResponse } from '../daily-api.js';

function database(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) ?? null; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      };
    },
  };
}
const request = (method, body, headers = {}) => new Request('https://obsidian.ibraim.ie/api/daily', {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
});
const call = (env, method, body, headers) => dailyResponse(request(method, body, headers), env, new URL('https://obsidian.ibraim.ie/api/daily'));

test('the daily list API stores, returns, and validates the list', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0010_add_daily_list.sql', import.meta.url), 'utf8'));
  const env = { DB: database(sqlite) };

  assert.deepEqual(await (await call(env, 'GET')).json(), { items: [], done: [], done_on: '' });

  const list = { items: [{ id: 'a1', text: ' Read 20 pages ' }, { id: 'b2', text: 'Solve one problem' }], done: ['b2'], done_on: '2026-11-07' };
  assert.equal((await call(env, 'PUT', list)).status, 200);
  assert.deepEqual(await (await call(env, 'GET')).json(), { ...list, items: [{ id: 'a1', text: 'Read 20 pages' }, list.items[1]] });

  const next = { ...list, done: [], done_on: '2026-11-08' };
  assert.equal((await call(env, 'PUT', next)).status, 200);
  assert.deepEqual((await (await call(env, 'GET')).json()).done, []);

  for (const bad of [
    { ...list, done: ['missing'] }, { ...list, done_on: '2026-02-30' }, { ...list, items: [{ id: 'a1', text: '' }] },
    { ...list, items: [{ id: 'a1', text: 'x' }, { id: 'a1', text: 'y' }], done: [] }, { items: 'nope', done: [], done_on: '' },
  ]) assert.equal((await call(env, 'PUT', bad)).status, 400);

  assert.equal((await call(env, 'PUT', list, { Origin: 'https://evil.example' })).status, 403);
  assert.equal(await dailyResponse(new Request('https://obsidian.ibraim.ie/api/other'), env, new URL('https://obsidian.ibraim.ie/api/other')), null);
});
