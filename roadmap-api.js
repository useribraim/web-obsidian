import { ROADMAP_KEYS, ROADMAP_LANGUAGE_NAMES } from './public/roadmap-data.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BATCH = 100;
const columns = 'id, problem_key AS key, title, language, solved_on AS date';

function validEntry(entry) {
  return entry && typeof entry.key === 'string' && typeof entry.title === 'string'
    && entry.title.trim().length > 0 && entry.title.length <= 100
    && (ROADMAP_KEYS.has(entry.key) || (/^other:[a-z0-9+#]{1,80}$/.test(entry.key)))
    && (entry.language === '' || ROADMAP_LANGUAGE_NAMES.has(entry.language))
    && typeof entry.date === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(entry.date)
    && new Date(entry.date + 'T00:00:00Z').toISOString().slice(0, 10) === entry.date;
}

export async function roadmapResponse(request, env, url) {
  if (!url.pathname.startsWith('/api/roadmap')) return null;
  const sameOrigin = !request.headers.get('Origin') || request.headers.get('Origin') === url.origin;

  if (url.pathname === '/api/roadmap' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT ${columns} FROM roadmap_solves ORDER BY created_at, id`).all();
    return json(results);
  }

  if (url.pathname === '/api/roadmap' && request.method === 'POST') {
    if (!sameOrigin) return json({ error: 'Invalid origin.' }, 403);
    const text = await request.text();
    if (text.length > 32768) return json({ error: 'This list is too large.' }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: 'Invalid request.' }, 400); }
    const entries = data?.entries;
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_BATCH || !entries.every(validEntry)) {
      return json({ error: `Send between 1 and ${MAX_BATCH} valid solves.` }, 400);
    }
    const rows = entries.map(entry => ({ id: crypto.randomUUID(), key: entry.key, title: entry.title.trim(), language: entry.language, date: entry.date }));
    await env.DB.batch(rows.map(row => env.DB.prepare('INSERT INTO roadmap_solves (id, problem_key, title, language, solved_on) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, row.key, row.title, row.language, row.date)));
    return json(rows.map(row => ({ id: row.id, key: row.key, title: row.title, language: row.language, date: row.date })), 201);
  }

  const match = /^\/api\/roadmap\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (match && request.method === 'DELETE') {
    if (!sameOrigin) return json({ error: 'Invalid origin.' }, 403);
    await env.DB.prepare('DELETE FROM roadmap_solves WHERE id = ?').bind(match[1]).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found.' }, 404);
}
