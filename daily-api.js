// The daily list is one row: the tasks that repeat every day, and the ones
// ticked on the day named in done_on. The page clears the ticks on a new day.
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_ITEMS = 50;
const EMPTY = { items: [], done: [], done_on: '' };

function validDate(text) {
  return text === '' || (/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(text)
    && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text);
}
function validList(data) {
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.done) || typeof data.done_on !== 'string') return false;
  if (data.items.length > MAX_ITEMS || data.done.length > MAX_ITEMS || !validDate(data.done_on)) return false;
  const ids = new Set();
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id) || ids.has(item.id)) return false;
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 200) return false;
    ids.add(item.id);
  }
  return data.done.every(id => ids.has(id));
}

export async function dailyResponse(request, env, url) {
  if (url.pathname !== '/api/daily') return null;
  const sameOrigin = !request.headers.get('Origin') || request.headers.get('Origin') === url.origin;

  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT items, done, done_on FROM daily_list WHERE id = 1').first();
    return json(row ? { items: JSON.parse(row.items), done: JSON.parse(row.done), done_on: row.done_on } : EMPTY);
  }

  if (request.method === 'PUT') {
    if (!sameOrigin) return json({ error: 'Invalid origin.' }, 403);
    const text = await request.text();
    if (text.length > 16384) return json({ error: 'This list is too large.' }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (!validList(data)) return json({ error: `Send up to ${MAX_ITEMS} daily tasks of up to 200 characters.` }, 400);
    const list = { items: data.items.map(item => ({ id: item.id, text: item.text.trim() })), done: data.done, done_on: data.done_on };
    await env.DB.prepare(
      "INSERT INTO daily_list (id, items, done, done_on) VALUES (1, ?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET items = ?1, done = ?2, done_on = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    ).bind(JSON.stringify(list.items), JSON.stringify(list.done), list.done_on).run();
    return json(list);
  }

  return json({ error: 'Not found.' }, 404);
}
