import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpResponse } from '../mcp.js';

function database(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args); },
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

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      deleted_at TEXT
    );
    CREATE TABLE mcp_note_events (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      note_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  return { sqlite, env: { DB: database(sqlite) } };
}

function jsonResult(result) {
  return JSON.parse(result.content[0].text);
}

async function connect(env, principal) {
  const origin = 'https://notes.test';
  const fetch = (url, init) => mcpResponse(new Request(origin + new URL(url).pathname, init), env, principal);
  const client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { fetch }));
  return client;
}

test('real MCP client discovers scoped tools and performs safe note writes', async () => {
  const { sqlite, env } = setup();
  const principal = { id: 'connection-1', name: 'Test Agent', scopes: ['notes:read', 'notes:create', 'notes:append', 'notes:edit'] };
  const client = await connect(env, principal);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), [
      'list_notes', 'search_notes', 'read_note', 'create_note', 'append_to_note', 'update_note',
    ]);
    assert.equal(listed.tools.find(tool => tool.name === 'read_note').annotations.readOnlyHint, true);
    assert.equal(listed.tools.find(tool => tool.name === 'update_note').annotations.destructiveHint, true);

    const created = await client.callTool({ name: 'create_note', arguments: { title: '  Plan  ', content: 'secret body' } });
    assert.equal(created.isError, undefined);
    const metadata = jsonResult(created);
    assert.deepEqual(Object.keys(metadata).sort(), ['id', 'title', 'updated_at', 'version']);
    assert.equal(metadata.title, 'Plan');

    const read = await client.callTool({ name: 'read_note', arguments: { id: metadata.id } });
    assert.equal(jsonResult(read).content, 'secret body');
    assert.equal(jsonResult(read).version, 1);

    const appended = await client.callTool({ name: 'append_to_note', arguments: { id: metadata.id, content: '\nmore' } });
    assert.equal(jsonResult(appended).version, 2);
    assert.equal(jsonResult(await client.callTool({ name: 'read_note', arguments: { id: metadata.id } })).content, 'secret body\nmore');

    const stale = await client.callTool({ name: 'update_note', arguments: { id: metadata.id, title: 'Overwritten', content: 'bad', expected_version: 1 } });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /changed since version 1/);
    assert.equal(jsonResult(await client.callTool({ name: 'read_note', arguments: { id: metadata.id } })).content, 'secret body\nmore');

    const search = await client.callTool({ name: 'search_notes', arguments: { query: 'secret' } });
    const searchResult = jsonResult(search);
    assert.equal(searchResult.results[0].snippet, 'secret body\nmore');
    assert.equal(searchResult.results[0].content, undefined);
    assert.equal(jsonResult(await client.callTool({ name: 'search_notes', arguments: { query: '%' } })).results.length, 0);
    assert.equal(jsonResult(await client.callTool({ name: 'search_notes', arguments: { query: '_' } })).results.length, 0);
    const page = jsonResult(await client.callTool({ name: 'list_notes', arguments: { limit: 1, offset: 0 } }));
    assert.equal(page.notes.length, 1);
    assert.equal(page.has_more, false);
    assert.equal(page.next_offset, null);

    const events = sqlite.prepare('SELECT connection_id, connection_name, note_id, action FROM mcp_note_events ORDER BY rowid').all();
    assert.deepEqual(events.map(event => event.action), ['create', 'append']);
    assert.equal(events[0].connection_id, 'connection-1');
    assert.equal(events[0].connection_name, 'Test Agent');
  } finally {
    await client.close();
    sqlite.close();
  }
});

test('scope filtering, trash isolation, origin checks, and bounds are enforced', async () => {
  const { sqlite, env } = setup();
  const trashedId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  sqlite.prepare('INSERT INTO notes (id, title, content, deleted_at) VALUES (?, ?, ?, ?)').run(trashedId, 'Hidden', 'do not expose', '2026-01-01T00:00:00.000Z');
  const principal = { id: 'read-only', name: 'Reader', scopes: ['notes:read'] };
  const client = await connect(env, principal);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['list_notes', 'search_notes', 'read_note']);
    const trash = await client.callTool({ name: 'read_note', arguments: { id: trashedId } });
    assert.equal(trash.isError, true);
    assert.equal(trash.content[0].text, 'Note not found.');
    const tooMany = await client.callTool({ name: 'list_notes', arguments: { limit: 101 } });
    assert.equal(tooMany.isError, true);
    assert.match(tooMany.content[0].text, /less than or equal to 100/);
    const forbidden = await client.callTool({ name: 'create_note', arguments: { title: 'No', content: 'write' } });
    assert.equal(forbidden.isError, true);
    assert.match(forbidden.content[0].text, /not found/);
  } finally {
    await client.close();
    sqlite.close();
  }

  const invalidOrigin = await mcpResponse(new Request('https://notes.test/mcp', {
    method: 'POST',
    headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
  }), env, principal);
  assert.equal(invalidOrigin.status, 403);
  assert.equal(invalidOrigin.headers.get('Cache-Control'), 'no-store');
});

test('append-only access protects note text and title, Unicode limits, and concurrent appends', async () => {
  const { sqlite, env } = setup();
  const id = crypto.randomUUID();
  sqlite.prepare('INSERT INTO notes (id, title, content) VALUES (?, ?, ?)').run(id, 'Private title', '\u0000' + '\ud83d\ude00'.repeat(99_998));
  const principal = { id: 'appender', name: 'Appender', scopes: ['notes:append'] };
  const client = await connect(env, principal);
  try {
    const tooLarge = await client.callTool({ name: 'append_to_note', arguments: { id, content: '\ud83d\ude00\ud83d\ude00' } });
    assert.equal(tooLarge.isError, true);
    assert.match(tooLarge.content[0].text, /exceed 200000/);
    assert.equal(sqlite.prepare('SELECT version FROM notes WHERE id = ?').get(id).version, 1);
    const saved = jsonResult(await client.callTool({ name: 'append_to_note', arguments: { id, content: 'abc' } }));
    assert.deepEqual(Object.keys(saved).sort(), ['id', 'updated_at', 'version']);
    assert.equal(saved.version, 2);
    assert.equal(sqlite.prepare('SELECT content FROM notes WHERE id = ?').get(id).content.length, 200_000);
    sqlite.prepare('UPDATE notes SET content = ? WHERE id = ?').run('start', id);
    const results = await Promise.all(['A', 'B'].map(content => client.callTool({ name: 'append_to_note', arguments: { id, content } })));
    assert.ok(results.every(result => !result.isError));
    const note = sqlite.prepare('SELECT content, version FROM notes WHERE id = ?').get(id);
    assert.match(note.content, /^start(AB|BA)$/);
    assert.equal(note.version, 4);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM mcp_note_events').get().count, 3);
  } finally {
    await client.close();
    sqlite.close();
  }
});

test('maximum-size escaped Markdown is accepted and failed audit writes roll back notes', async t => {
  const { sqlite, env } = setup();
  const client = await connect(env, { id: 'writer', name: 'Writer', scopes: ['notes:create'] });
  try {
    const result = await client.callTool({ name: 'create_note', arguments: { title: 'Large', content: '\u0001'.repeat(200_000) } });
    assert.equal(result.isError, undefined);
    assert.equal(sqlite.prepare('SELECT content FROM notes').get().content.length, 200_000);
    sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON mcp_note_events BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END;");
    const logged = t.mock.method(console, 'error', () => {});
    const failure = await client.callTool({ name: 'create_note', arguments: { title: 'Rollback', content: 'Must not survive' } });
    assert.equal(failure.isError, true);
    assert.equal(logged.mock.callCount(), 1);
    assert.equal(failure.content[0].text, 'Could not complete that note operation.');
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM notes').get().count, 1);
  } finally {
    await client.close();
    sqlite.close();
  }
});
