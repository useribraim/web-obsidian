// The lab's local server: static files for lab/, plus /api/buses as a tiny
// proxy in front of the NTA feed.
//
// Why a proxy at all? The NTA key must never reach the browser, and the feed
// does not send CORS headers. The Worker does the same job in production, for
// the same two reasons. Writing this is optional stage 8.
//
//   npm run lab            -> http://127.0.0.1:8788/
//
// The key comes from NTA_API_KEY in the environment, or from NTA_API_KEY=...
// in the repo's .dev.vars. Without it the proxy answers 503, which is the
// failure you handle in stage 6.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// bus-feed.js is an ES module, but this repo has no "type": "module" (the
// browser files are UMD scripts and the tests load them with createRequire).
// Import the source as a data URL so the lab can reuse the production parser
// without changing how the Worker or the tests resolve modules.
const feedSource = await readFile(new URL('../bus-feed.js', import.meta.url), 'utf8');
const { parseVehicles } = await import(`data:text/javascript;base64,${Buffer.from(feedSource).toString('base64')}`);

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = resolve(ROOT, '..');
const PORT = Number(process.env.PORT) || 8788;

const FEED = 'https://api.nationaltransport.ie/gtfsr/v2/Vehicles';
const FRESH_MS = 62_000;
const CACHE_KEY = 'buses';
const AREA = { south: 52.9, north: 53.7, west: -6.7, east: -5.9 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function readDevVars() {
  try {
    const text = await readFile(join(REPO, '.dev.vars'), 'utf8');
    const vars = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const at = trimmed.indexOf('=');
      if (at < 0) continue;
      vars[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
    return vars;
  } catch {
    return {};
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

let cache = null; // { at, buses }

async function liveBuses(apiKey) {
  const response = await fetch(FEED, { headers: { 'x-api-key': apiKey } });
  if (!response.ok) throw new Error(`The bus feed answered ${response.status}.`);
  const buses = parseVehicles(await response.arrayBuffer())
    .filter(bus => bus.lat >= AREA.south && bus.lat <= AREA.north && bus.lon >= AREA.west && bus.lon <= AREA.east);
  return buses;
}

async function buses(request, response, apiKey) {
  if (request.method !== 'GET') return send(response, json({ error: 'Method not allowed.' }, 405));
  if (!apiKey) {
    return send(response, json({ error: 'Live bus data is not set up. Add NTA_API_KEY to .dev.vars.' }, 503));
  }
  if (cache && Date.now() - cache.at < FRESH_MS) {
    return send(response, json({ updated: cache.at, buses: cache.buses }));
  }
  try {
    const fresh = await liveBuses(apiKey);
    cache = { at: Date.now(), buses: fresh };
    return send(response, json({ updated: cache.at, buses: fresh }));
  } catch (error) {
    console.error(`[buses] ${error.message}`);
    if (cache) return send(response, json({ updated: cache.at, buses: cache.buses, stale: true }));
    return send(response, json({ error: 'Could not load live bus data. Check the key and try again.' }, 502));
  }
}

async function send(response, result) {
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(await result.text());
}

async function staticFile(request, response, pathname) {
  let path = pathname;
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(ROOT, '.' + path);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    return send(response, json({ error: 'Not found.' }, 404));
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      response.writeHead(301, { Location: pathname + '/' });
      return response.end();
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    send(response, json({ error: 'Not found.' }, 404));
  }
}

const vars = await readDevVars();
const apiKey = process.env.NTA_API_KEY || vars.NTA_API_KEY || '';

createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return send(response, json({ error: 'Bad request.' }, 400));
  }
  if (pathname === '/api/buses') return buses(request, response, apiKey);
  if (pathname.startsWith('/api/')) return send(response, json({ error: 'Not found.' }, 404));
  return staticFile(request, response, pathname);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Bus lab: http://127.0.0.1:${PORT}/`);
  console.log(apiKey ? 'Live buses: key found.' : 'Live buses: no NTA_API_KEY — only the fixture will work.');
});
