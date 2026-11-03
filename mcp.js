import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { z } from 'zod';

const MAX_CONTENT = 200_000;
const MAX_TITLE = 200;
const MAX_LIMIT = 100;
const MAX_OFFSET = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idSchema = z.string().regex(UUID, 'id must be a UUID');
const titleSchema = z.string().max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`);
const contentSchema = z.string().max(MAX_CONTENT, `content must be at most ${MAX_CONTENT} characters`);
const pageSchema = {
  limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
  offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
};

class ToolFailure extends Error {}

const noStore = (response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const jsonError = (message, status) => noStore(Response.json({ error: message }, { status }));

function scopeSet(principal) {
  return new Set(Array.isArray(principal?.scopes) ? principal.scopes : []);
}

function noteTitle(title) {
  const trimmed = title.trim();
  return trimmed || 'Untitled note';
}

function likePattern(query) {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

function metadataResult(note) {
  return {
    id: note.id,
    title: note.title,
    version: note.version,
    updated_at: note.updated_at,
  };
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function safeTool(handler) {
  return async (...args) => {
    try {
      return toolResult(await handler(...args));
    } catch (error) {
      if (error instanceof ToolFailure) return toolError(error.message);
      console.error('MCP tool failed:', error);
      return toolError('Could not complete that note operation.');
    }
  };
}

function connectionValues(principal) {
  return {
    id: typeof principal?.id === 'string' ? principal.id.slice(0, 200) : 'unknown',
    name: typeof principal?.name === 'string' ? principal.name.slice(0, 200) : 'unknown',
  };
}

function auditStatement(principal, noteId, action) {
  const connection = connectionValues(principal);
  return {
    sql: `INSERT INTO mcp_note_events (id, connection_id, connection_name, note_id, action)
      SELECT ?, ?, ?, id, ? FROM notes
      WHERE id = ? AND deleted_at IS NULL AND changes() > 0`,
    values: [crypto.randomUUID(), connection.id, connection.name, action, noteId],
  };
}

function prepared(env, statement) {
  return env.DB.prepare(statement.sql).bind(...statement.values);
}

async function batch(env, statements) {
  return env.DB.batch(statements.map(statement => prepared(env, statement)));
}

async function writeNote(env, principal, id, title, content) {
  const updated_at = new Date().toISOString();
  await batch(env, [
    {
      sql: 'INSERT INTO notes (id, title, content, updated_at) VALUES (?, ?, ?, ?)',
      values: [id, title, content, updated_at],
    },
    auditStatement(principal, id, 'create'),
  ]);
  return { id, title, version: 1, updated_at };
}

async function appendNote(env, principal, id, content) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await env.DB.prepare('SELECT content, version FROM notes WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!existing) throw new ToolFailure('Note not found.');
    // SQLite length() counts code points and stops at NUL; the editor uses UTF-16 length.
    // Compare-and-swap keeps that same limit without losing a concurrent browser edit.
    if (existing.content.length + content.length > MAX_CONTENT) {
      throw new ToolFailure(`Appending would exceed ${MAX_CONTENT} characters.`);
    }
    const updated_at = new Date().toISOString();
    const writes = await batch(env, [
      {
        sql: `UPDATE notes SET content = content || ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        values: [content, updated_at, id, existing.version],
      },
      auditStatement(principal, id, 'append'),
    ]);
    if (writes[0].meta.changes) return { id, version: existing.version + 1, updated_at };
  }
  throw new ToolFailure('This note is changing frequently. Retry the append.');
}

async function updateNote(env, principal, id, title, content, expectedVersion) {
  const updated_at = new Date().toISOString();
  const writes = await batch(env, [
    {
      sql: `UPDATE notes SET title = ?, content = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      values: [title, content, updated_at, id, expectedVersion],
    },
    auditStatement(principal, id, 'update'),
  ]);
  const changes = Number(writes?.[0]?.meta?.changes ?? 0);
  if (!changes) {
    const existing = await env.DB.prepare('SELECT version, deleted_at FROM notes WHERE id = ?').bind(id).first();
    if (!existing || existing.deleted_at) throw new ToolFailure('Note not found.');
    throw new ToolFailure(`Note changed since version ${expectedVersion}; read it again before updating.`);
  }
  return { id, title, version: expectedVersion + 1, updated_at };
}

function registerTools(server, env, principal) {
  const scopes = scopeSet(principal);
  const can = scope => scopes.has(scope);
  const annotations = (readOnlyHint, destructiveHint, idempotentHint) => ({
    readOnlyHint,
    destructiveHint,
    idempotentHint,
    openWorldHint: false,
  });

  if (can('notes:read')) {
    server.registerTool('list_notes', {
      description: 'List active notes in updated order. Returns metadata only and supports pagination.',
      inputSchema: z.object(pageSchema),
      annotations: annotations(true, false, true),
    }, safeTool(async ({ limit, offset }) => {
      const rows = await env.DB.prepare(
        'SELECT id, title, version, updated_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?'
      ).bind(limit + 1, offset).all();
      const notes = rows.results.slice(0, limit).map(metadataResult);
      const has_more = rows.results.length > limit;
      return { notes, limit, offset, has_more, next_offset: has_more ? offset + limit : null };
    }));

    server.registerTool('search_notes', {
      description: 'Search active notes using a literal text query. Returns metadata and short snippets, never full note content.',
      inputSchema: z.object({ query: z.string().min(1).max(200), ...pageSchema }),
      annotations: annotations(true, false, true),
    }, safeTool(async ({ query, limit, offset }) => {
      const pattern = likePattern(query);
      const rows = await env.DB.prepare(
        `SELECT id, title, version, updated_at,
          CASE WHEN instr(lower(content), lower(?)) > 0
            THEN substr(content, max(1, instr(lower(content), lower(?)) - 80), 200)
            ELSE substr(content, 1, 200) END AS snippet
          FROM notes
          WHERE deleted_at IS NULL
            AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
          ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`
      ).bind(query, query, pattern, pattern, limit + 1, offset).all();
      const results = rows.results.slice(0, limit).map(row => ({
        id: row.id,
        title: row.title,
        version: row.version,
        updated_at: row.updated_at,
        snippet: row.snippet,
      }));
      const has_more = rows.results.length > limit;
      return { results, query, limit, offset, has_more, next_offset: has_more ? offset + limit : null };
    }));

    server.registerTool('read_note', {
      description: 'Read one active note, including its full Markdown content and current version.',
      inputSchema: z.object({ id: idSchema }),
      annotations: annotations(true, false, true),
    }, safeTool(async ({ id }) => {
      const note = await env.DB.prepare(
        'SELECT id, title, content, version, updated_at FROM notes WHERE id = ? AND deleted_at IS NULL'
      ).bind(id).first();
      if (!note) throw new ToolFailure('Note not found.');
      return note;
    }));
  }

  if (can('notes:create')) {
    server.registerTool('create_note', {
      description: 'Create a note. Returns metadata only; it never returns note content.',
      inputSchema: z.object({ title: titleSchema, content: contentSchema }),
      annotations: annotations(false, false, false),
    }, safeTool(async ({ title, content }) => writeNote(env, principal, crypto.randomUUID(), noteTitle(title), content)));
  }

  if (can('notes:append')) {
    server.registerTool('append_to_note', {
      description: 'Atomically append Markdown to an active note and increment its version.',
      inputSchema: z.object({ id: idSchema, content: contentSchema }),
      annotations: annotations(false, false, false),
    }, safeTool(async ({ id, content }) => appendNote(env, principal, id, content)));
  }

  if (can('notes:edit')) {
    server.registerTool('update_note', {
      description: 'Replace a note title and Markdown content only if expected_version is current.',
      inputSchema: z.object({
        id: idSchema,
        title: titleSchema,
        content: contentSchema,
        expected_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      }),
      annotations: annotations(false, true, true),
    }, safeTool(async ({ id, title, content, expected_version }) => updateNote(env, principal, id, noteTitle(title), content, expected_version)));
  }
}

export async function mcpResponse(request, env, principal) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return jsonError('Invalid origin.', 403);

  let server;
  try {
    // No session ID generator is intentional: this server is rebuilt for every request.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_CONTENT * 6 + 16_384,
    });
    server = new McpServer({ name: 'obsidian-notes', version: '1.0.0' }, {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    });
    registerTools(server, env, principal);
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const result = noStore(response);
    // A GET response owns a live SSE stream; closing it here would terminate it.
    if (request.method !== 'GET') await server.close();
    return result;
  } catch (error) {
    if (server) {
      try { await server.close(); } catch {}
    }
    console.error('MCP request failed:', error);
    return jsonError('Could not process the MCP request.', 500);
  }
}
