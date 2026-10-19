import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';
import { ROADMAP, ROADMAP_PROBLEMS } from '../public/roadmap-data.js';

const migration = readFileSync(new URL('../migrations/0007_add_roadmap.sql', import.meta.url), 'utf8');
function database(sqlite) {
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
    };
  } };
}

test('roadmap contains the 150 unique problems in ten complete stages', () => {
  assert.equal(ROADMAP_PROBLEMS.length, 150);
  assert.equal(new Set(ROADMAP_PROBLEMS.map(problem => problem.id)).size, 150);
  assert.equal(new Set(ROADMAP.map(stage => stage.id)).size, 10);
  assert.deepEqual(ROADMAP.map(stage => stage.groups.flatMap(group => group.problems).length), [38, 14, 11, 11, 21, 7, 9, 11, 16, 12]);
  for (const problem of ROADMAP_PROBLEMS) {
    assert.match(problem.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(problem.title);
    assert.ok(['Easy', 'Medium', 'Hard'].includes(problem.difficulty));
  }
});

test('migration is idempotent and compatible with the fresh-install schema', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(migration);
    sqlite.exec(migration);
    assert.deepEqual(sqlite.prepare('SELECT * FROM roadmap_progress').all(), []);
    assert.throws(() => sqlite.prepare('INSERT INTO roadmap_progress VALUES (?, ?, ?)').run('two-sum', 3, 'now'));
  } finally { sqlite.close(); }
});

test('authenticated API validates and persists per-problem progress in SQLite', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  const env = { PASSWORD: 'test-only-password', DB: database(sqlite) };
  const origin = 'https://roadmap.test';
  let cookie = '';
  async function request(path, method = 'GET', body, headers = {}) {
    return worker.fetch(new Request(origin + path, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }), env);
  }
  try {
    assert.equal((await request('/api/roadmap')).status, 401);
    assert.equal((await request('/api/roadmap/two-sum', 'PUT', { completed: true })).status, 401);
    const login = await request('/api/auth/login', 'POST', { password: env.PASSWORD });
    assert.equal(login.status, 200);
    cookie = login.headers.get('Set-Cookie').split(';')[0];
    assert.deepEqual(await (await request('/api/roadmap')).json(), []);
    assert.equal((await request('/api/roadmap/two-sum', 'PUT', { completed: true }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await request('/api/roadmap/not-a-real-problem', 'PUT', { completed: true })).status, 404);
    assert.equal((await request('/api/roadmap/two-sum', 'DELETE')).status, 405);
    for (const body of ['{', 'null', '{}', '[]', '{"completed":1}', '{"completed":"false"}']) {
      assert.equal((await request('/api/roadmap/two-sum', 'PUT', body)).status, 400, body);
    }
    assert.equal((await request('/api/roadmap/two-sum', 'PUT', 'x'.repeat(513))).status, 413);
    const saved = await request('/api/roadmap/two-sum', 'PUT', { completed: true }, { Origin: origin });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('Cache-Control'), 'no-store');
    const result = await saved.json();
    assert.equal(result.problem_id, 'two-sum');
    assert.equal(result.completed, 1);
    assert.ok(!Number.isNaN(Date.parse(result.updated_at)));
    await request('/api/roadmap/valid-anagram', 'PUT', { completed: true });
    // Repeating a save is safe, and unchecking one problem leaves others untouched.
    await request('/api/roadmap/two-sum', 'PUT', { completed: true });
    await request('/api/roadmap/two-sum', 'PUT', { completed: false });
    const rows = await (await request('/api/roadmap')).json();
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.problem_id === 'two-sum').completed, 0);
    assert.equal(rows.find(row => row.problem_id === 'valid-anagram').completed, 1);
    // Re-create the D1 adapter to model another request / worker instance.
    env.DB = database(sqlite);
    assert.deepEqual(await (await request('/api/roadmap')).json(), rows);
  } finally { sqlite.close(); }
});
