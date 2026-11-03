import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../worker.js';

function database(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('MCP migration is idempotent for existing and fresh-install databases', () => {
  const migration = readFileSync(new URL('../migrations/0008_add_mcp.sql', import.meta.url), 'utf8');
  const fresh = new DatabaseSync(':memory:');
  const existing = new DatabaseSync(':memory:');
  try {
    fresh.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    fresh.exec(migration);
    existing.exec(migration);
    existing.exec(migration);
    const tables = ['mcp_agent_connections', 'mcp_oauth_clients', 'mcp_oauth_codes', 'mcp_oauth_tokens', 'mcp_note_events'];
    for (const table of tables) {
      assert.deepEqual(fresh.prepare(`PRAGMA table_info(${table})`).all(), existing.prepare(`PRAGMA table_info(${table})`).all());
    }
  } finally {
    fresh.close();
    existing.close();
  }
});

test('Worker separates browser and MCP credentials and preserves concurrent note edits', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: database(sqlite), PASSWORD: 'worker-test-password', ASSETS: { fetch: async () => new Response('<html></html>') } };
  const origin = 'https://worker.test';
  let cookie = '';
  const request = (path, method = 'GET', body, headers = {}) => worker.fetch(new Request(origin + path, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const client = new Client({ name: 'worker-test', version: '1.0.0' });
  const value = result => JSON.parse(result.content[0].text);
  try {
    const unauthorized = await request('/mcp');
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('WWW-Authenticate'), /oauth-protected-resource\/mcp/);
    assert.equal((await request('/api/agent-connections')).status, 401);
    const metadata = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
    assert.equal(metadata.resource, origin + '/mcp');
    const loginPage = await request('/oauth/authorize?client_id=not-registered');
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /name="next" value="\/oauth\/authorize\?client_id=not-registered"/);

    const login = await request('/api/auth/login', 'POST', { password: env.PASSWORD });
    assert.equal(login.status, 200);
    cookie = login.headers.get('Set-Cookie').split(';')[0];
    const settings = await request('/agents');
    assert.equal(settings.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(settings.headers.get('Cache-Control'), 'no-store');
    assert.equal((await request('/mcp')).status, 401, 'A browser session is not an MCP credential');
    const createdConnection = await request('/api/agent-connections', 'POST', {
      name: 'Integration harness', grant: 'whole_notebook', consent: true,
      scopes: ['notes:read', 'notes:create', 'notes:append', 'notes:edit'],
    }, { Origin: origin });
    assert.equal(createdConnection.status, 201);
    const connection = await createdConnection.json();
    const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
      fetch: (input, init) => worker.fetch(new Request(input, init), env),
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
    const note = value(await client.callTool({ name: 'create_note', arguments: { title: 'Shared note', content: 'Agent draft' } }));
    assert.equal((await (await request('/api/notes/' + note.id)).json()).content, 'Agent draft');
    assert.equal((await request('/api/notes/' + note.id, 'PUT', { title: note.title, content: 'Browser edit', version: 1 })).status, 200);
    const read = value(await client.callTool({ name: 'read_note', arguments: { id: note.id } }));
    assert.equal(read.content, 'Browser edit');
    assert.equal(read.version, 2);
    await client.callTool({ name: 'append_to_note', arguments: { id: note.id, content: '\nAgent addition' } });
    assert.equal((await request('/api/notes/' + note.id, 'PUT', { title: note.title, content: 'Stale browser edit', version: 2 })).status, 409);
    assert.equal((await (await request('/api/notes/' + note.id)).json()).content, 'Browser edit\nAgent addition');
    const updated = value(await client.callTool({ name: 'update_note', arguments: { id: note.id, title: 'Final note', content: 'Final content', expected_version: 3 } }));
    assert.equal(updated.version, 4);
    assert.equal((await (await request('/api/notes/' + note.id)).json()).title, 'Final note');
    await request('/api/notes/' + note.id, 'DELETE');
    assert.equal((await client.callTool({ name: 'read_note', arguments: { id: note.id } })).isError, true);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM mcp_note_events').get().count, 3);
    const listing = await (await request('/api/agent-connections')).json();
    assert.ok(listing[0].last_used_at);
    assert.equal(listing[0].token, undefined);
    assert.equal(listing[0].token_hash, undefined);
    assert.equal((await request('/api/notes', 'GET', undefined, { Cookie: '', Authorization: `Bearer ${connection.token}` })).status, 401, 'MCP tokens cannot access browser APIs');
    await request('/api/agent-connections/' + connection.id, 'DELETE', undefined, { Origin: origin });
    await assert.rejects(() => client.listTools(), error => error.code === 401);
  } finally {
    await client.close();
    sqlite.close();
  }
});
