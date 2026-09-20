const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

const SESSION_COOKIE = 'obsidian_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours, matching tether.ibraim.ie
const noteQuery = 'SELECT id, title, content, version, updated_at, deleted_at FROM notes WHERE id = ?';
const sameOrigin = (request, url) => !request.headers.get('Origin') || request.headers.get('Origin') === url.origin;

// Slow repeated failed sign-ins so the password cannot be guessed at network
// speed. Same policy as tether.ibraim.ie: the first few attempts are free, then
// every further failure doubles the delay, capped at ten seconds.
const FREE_ATTEMPTS = 3;
const MAX_DELAY_MS = 10_000;
const STEP_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let loginFailures = 0;
const loginDelayMs = () => (loginFailures <= FREE_ATTEMPTS ? 0 : Math.min(MAX_DELAY_MS, STEP_MS * 2 ** (loginFailures - FREE_ATTEMPTS - 1)));
const safeNext = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');

function loginPage({ failed = false, next = '/' } = {}) {
  const notice = failed
    ? '<p id="error" role="alert">That password did not match.</p>'
    : '<div id="error" role="alert"></div>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#191919">
  <title>Notes — Sign in</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #d4d4d4; background: #1e1e1e; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; }
    form { width: min(360px, calc(100% - 40px)); padding: 28px; background: #191919; border: 1px solid #292929; border-radius: 10px; }
    h1 { margin: 0 0 22px; font-size: 18px; font-weight: 550; }
    label { display: block; margin-bottom: 8px; color: #999; font-size: 13px; }
    input { width: 100%; padding: 11px 12px; color: #d4d4d4; background: #232323; border: 1px solid #3a3a3a; border-radius: 5px; outline: none; }
    input:focus { border-color: #a899ce; }
    button { width: 100%; margin-top: 16px; padding: 10px 13px; color: #c9bcdf; background: #302a3b; border: 0; border-radius: 5px; cursor: pointer; }
    button:hover { background: #40354f; }
    #error { min-height: 18px; margin: 12px 0 0; color: #e7a39c; font-size: 12px; }
  </style>
</head>
<body>
  <form method="post" action="/api/auth/login">
    <h1>Notes</h1>
    <input type="hidden" name="next" value="${safeNext(next).replace(/"/g, '&quot;')}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
    ${notice}
  </form>
</body>
</html>`;
}

function cookieValue(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function signature(payload, password) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

async function isAuthenticated(request, env) {
  if (!env.PASSWORD) return false;
  const token = cookieValue(request, SESSION_COOKIE);
  const [expires, nonce, encodedSignature] = token.split('.');
  if (!expires || !nonce || !encodedSignature || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  try {
    const expected = await signature(expires + '.' + nonce, env.PASSWORD);
    const actual = fromBase64Url(encodedSignature);
    return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  } catch { return false; }
}

async function sessionCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = expires + '.' + crypto.randomUUID();
  const signed = toBase64Url(await signature(payload, env.PASSWORD));
  return `${SESSION_COOKIE}=${payload}.${signed}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function authResponse(request, env, url) {
  if (!env.PASSWORD) return json({ error: 'Password protection is not configured.' }, 503);
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    return json({ authenticated: await isAuthenticated(request, env) });
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` } });
  }
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
    const isForm = !(request.headers.get('Content-Type') || '').includes('application/json');
    const text = await request.text();
    if (text.length > 8192) return json({ error: 'Invalid sign-in request.' }, 400);
    let password;
    let next = '/';
    if (isForm) {
      const params = new URLSearchParams(text);
      password = params.get('password');
      next = safeNext(params.get('next'));
    } else {
      try { password = JSON.parse(text)?.password; } catch { return json({ error: 'Invalid sign-in request.' }, 400); }
    }
    const retry = (message) => isForm
      ? new Response(loginPage({ failed: true, next }), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      : json({ error: message }, 401);
    if (typeof password !== 'string' || password.length === 0 || password.length > 500) {
      return isForm ? retry('Enter your password.') : json({ error: 'Enter your password.' }, 400);
    }
    const delay = loginDelayMs();
    if (delay) await sleep(delay);
    const supplied = await signature(password, env.PASSWORD);
    const expected = await signature(env.PASSWORD, env.PASSWORD);
    const valid = supplied.length === expected.length && supplied.every((byte, index) => byte === expected[index]);
    if (!valid) {
      loginFailures += 1;
      return retry('Incorrect password.');
    }
    loginFailures = 0;
    const cookie = await sessionCookie(env);
    if (isForm) {
      return new Response(null, { status: 303, headers: { Location: next, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie } });
  }
  return null;
}

async function parseNote(request) {
  const text = await request.text();
  if (text.length > 220000) return { response: json({ error: 'This note is too large.' }, 413) };
  let data;
  try { data = JSON.parse(text); } catch { return { response: json({ error: 'Invalid note.' }, 400) }; }
  if (!data || typeof data.title !== 'string' || typeof data.content !== 'string' || data.title.length > 200 || data.content.length > 200000) {
    return { response: json({ error: 'Use a title under 200 characters and a note under 200,000 characters.' }, 400) };
  }
  return { title: data.title.trim() || 'Untitled note', content: data.content, version: data.version };
}

// Time entries. One entry can run at a time: starting a new one stops the
// running one first, the way a single stopwatch would. Timestamps are stored
// as ISO strings in UTC so string order equals time order.
const entryQuery = 'SELECT id, description, started_at, stopped_at FROM time_entries WHERE id = ?';
// The page sends a heartbeat every few minutes while the clock runs. A laptop
// that sleeps sends none, so an entry whose last heartbeat is older than this
// is stopped at that heartbeat before any time request is answered.
const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;
const closeStaleEntries = (env, now) => env.DB.prepare(
  'UPDATE time_entries SET stopped_at = seen_at WHERE stopped_at IS NULL AND seen_at IS NOT NULL AND seen_at < ?'
).bind(new Date(Date.parse(now) - HEARTBEAT_TIMEOUT_MS).toISOString()).run();
const isoTime = (value) => {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

async function parseEntry(request) {
  const text = await request.text();
  if (text.length > 4096) return { response: json({ error: 'This time entry is too large.' }, 413) };
  let data;
  try { data = JSON.parse(text); } catch { return { response: json({ error: 'Invalid time entry.' }, 400) }; }
  if (!data || typeof data.description !== 'string' || data.description.length > 200) {
    return { response: json({ error: 'Use a description under 200 characters.' }, 400) };
  }
  return { description: data.description.trim(), started_at: data.started_at, stopped_at: data.stopped_at };
}

async function timeResponse(request, env, url) {
  if (!url.pathname.startsWith('/api/time')) return null;
  if (request.method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
  const now = new Date().toISOString();
  await closeStaleEntries(env, now);

  if (url.pathname === '/api/time' && request.method === 'GET') {
    const since = isoTime(url.searchParams.get('since') || '1970-01-01T00:00:00.000Z');
    if (!since) return json({ error: 'Invalid since date.' }, 400);
    const { results } = await env.DB.prepare(
      'SELECT id, description, started_at, stopped_at FROM time_entries WHERE stopped_at IS NULL OR stopped_at >= ? ORDER BY started_at DESC'
    ).bind(since).all();
    return json(results);
  }

  if (url.pathname === '/api/time' && request.method === 'POST') {
    const data = await parseEntry(request);
    if (data.response) return data.response;
    const newId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('UPDATE time_entries SET stopped_at = ? WHERE stopped_at IS NULL').bind(now),
      env.DB.prepare('INSERT INTO time_entries (id, description, started_at, seen_at) VALUES (?, ?, ?, ?)').bind(newId, data.description, now, now),
    ]);
    return json(await env.DB.prepare(entryQuery).bind(newId).first(), 201);
  }

  const match = url.pathname.match(/^\/api\/time\/([a-f0-9-]{36})(\/stop|\/heartbeat)?$/);
  if (!match) return json({ error: 'Not found.' }, 404);
  const id = match[1];
  const stop = match[2] === '/stop';

  if (request.method === 'POST' && match[2] === '/heartbeat') {
    await env.DB.prepare('UPDATE time_entries SET seen_at = ? WHERE id = ? AND stopped_at IS NULL').bind(now, id).run();
    const entry = await env.DB.prepare(entryQuery).bind(id).first();
    return entry ? json(entry) : json({ error: 'Time entry not found.' }, 404);
  }

  if (request.method === 'POST' && stop) {
    const result = await env.DB.prepare('UPDATE time_entries SET stopped_at = ? WHERE id = ? AND stopped_at IS NULL').bind(now, id).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare(entryQuery).bind(id).first();
      return existing ? json(existing) : json({ error: 'Time entry not found.' }, 404);
    }
    return json(await env.DB.prepare(entryQuery).bind(id).first());
  }

  if (request.method === 'PUT' && !stop) {
    const data = await parseEntry(request);
    if (data.response) return data.response;
    if (data.started_at === undefined && data.stopped_at === undefined) {
      const result = await env.DB.prepare('UPDATE time_entries SET description = ? WHERE id = ?').bind(data.description, id).run();
      if (!result.meta.changes) return json({ error: 'Time entry not found.' }, 404);
      return json(await env.DB.prepare(entryQuery).bind(id).first());
    }
    const startedAt = isoTime(data.started_at);
    const stoppedAt = isoTime(data.stopped_at);
    if (!startedAt || !stoppedAt) return json({ error: 'Give the entry a valid start and stop time.' }, 400);
    if (stoppedAt < startedAt) return json({ error: 'The stop time must come after the start time.' }, 400);
    if (stoppedAt > now) return json({ error: 'The stop time cannot be in the future.' }, 400);
    const result = await env.DB.prepare('UPDATE time_entries SET description = ?, started_at = ?, stopped_at = ? WHERE id = ?')
      .bind(data.description, startedAt, stoppedAt, id).run();
    if (!result.meta.changes) return json({ error: 'Time entry not found.' }, 404);
    return json(await env.DB.prepare(entryQuery).bind(id).first());
  }

  if (request.method === 'DELETE' && !stop) {
    const result = await env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return json({ error: 'Time entry not found.' }, 404);
    return json({ ok: true });
  }

  return json({ error: 'Not found.' }, 404);
}

const IMAGE_LIMIT = 1_500_000;
function imageType(bytes) {
  const starts = signature => signature.every((value, index) => bytes[index] === value);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (/^GIF8[79]a/.test(text)) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
async function imageResponse(request, env, url) {
  if (url.pathname === '/api/images' && request.method === 'POST') {
    if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
    if (Number(request.headers.get('Content-Length')) > IMAGE_LIMIT) return json({ error: 'Image is too large. Please use a smaller image.' }, 413);
    if (!request.body) return json({ error: 'Choose an image to upload.' }, 400);
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > IMAGE_LIMIT) {
        await reader.cancel();
        return json({ error: 'Image is too large. Please use a smaller image.' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = imageType(bytes);
    if (!type) return json({ error: 'Use a PNG, JPEG, WebP or GIF image.' }, 415);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO images (id, content_type, data) VALUES (?, ?, ?)').bind(id, type, bytes.buffer).run();
    return json({ url: '/api/images/' + id }, 201);
  }
  const match = /^\/api\/images\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) {
    const image = await env.DB.prepare('SELECT content_type, data FROM images WHERE id = ?').bind(match[1]).first();
    if (!image) return json({ error: 'Image not found.' }, 404);
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(image.data), {
      headers: { 'Content-Type': image.content_type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const auth = await authResponse(request, env, url);
      if (auth) return auth;
      if (!(await isAuthenticated(request, env))) {
        if (!url.pathname.startsWith('/api/')) {
          return new Response(loginPage({ next: url.pathname + url.search }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        return json({ error: 'Sign in required.' }, 401);
      }
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const image = await imageResponse(request, env, url);
      if (image) return image;
      const time = await timeResponse(request, env, url);
      if (time) return time;
      if (url.pathname === '/api/notes' && request.method === 'GET') {
        const trash = url.searchParams.get('trash') === '1';
        const { results } = await env.DB.prepare(
          trash
            ? 'SELECT id, title, updated_at, deleted_at FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
            : 'SELECT id, title, updated_at, deleted_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC'
        ).all();
        return json(results);
      }

      const match = url.pathname.match(/^\/api\/notes\/([a-f0-9-]{36})(\/restore)?$/);
      const id = match?.[1];
      const restore = match?.[2] === '/restore';

      if (match && request.method === 'GET') {
        const note = await env.DB.prepare(noteQuery).bind(id).first();
        return note ? json(note) : json({ error: 'Note not found.' }, 404);
      }

      if (request.method === 'POST' && url.pathname === '/api/notes') {
        if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
        const data = await parseNote(request);
        if (data.response) return data.response;
        const newId = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO notes (id, title, content) VALUES (?, ?, ?)').bind(newId, data.title, data.content).run();
        return json(await env.DB.prepare(noteQuery).bind(newId).first(), 201);
      }

      if (request.method === 'PUT' && match && !restore) {
        if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
        const data = await parseNote(request);
        if (data.response) return data.response;
        if (!Number.isInteger(data.version)) return json({ error: 'Missing note version.' }, 400);
        const result = await env.DB.prepare("UPDATE notes SET title = ?, content = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND version = ? AND deleted_at IS NULL").bind(data.title, data.content, id, data.version).run();
        if (!result.meta.changes) {
          const existing = await env.DB.prepare('SELECT deleted_at FROM notes WHERE id = ?').bind(id).first();
          if (!existing) return json({ error: 'Note not found.' }, 404);
          if (existing.deleted_at) return json({ error: 'This note was moved to trash.' }, 410);
          return json({ error: 'Someone else changed this note. Copy your text, then reopen the note to see the latest version.' }, 409);
        }
        return json(await env.DB.prepare(noteQuery).bind(id).first());
      }

      if (request.method === 'POST' && match && restore) {
        if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
        const existing = await env.DB.prepare('SELECT id, deleted_at FROM notes WHERE id = ?').bind(id).first();
        if (!existing) return json({ error: 'Note not found.' }, 404);
        if (existing.deleted_at) await env.DB.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').bind(id).run();
        return json(await env.DB.prepare(noteQuery).bind(id).first());
      }

      if (request.method === 'DELETE' && match && !restore) {
        if (!sameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
        const existing = await env.DB.prepare('SELECT id, deleted_at FROM notes WHERE id = ?').bind(id).first();
        if (!existing) return json({ error: 'Note not found.' }, 404);
        if (url.searchParams.get('forever') === '1') {
          if (!existing.deleted_at) return json({ error: 'Move the note to trash before deleting it forever.' }, 409);
          await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
          return json({ ok: true });
        }
        if (!existing.deleted_at) await env.DB.prepare("UPDATE notes SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(id).run();
        return json(await env.DB.prepare(noteQuery).bind(id).first());
      }

      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Could not save or load notes. Please try again.' }, 500);
    }
  },
};
