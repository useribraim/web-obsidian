import { parseVehicles } from './bus-feed.js';

const FEED = 'https://api.nationaltransport.ie/gtfsr/v2/Vehicles';
// The NTA allows one request every 60 seconds for each token, so every viewer
// shares one copy of the feed, kept for 62 seconds.
const FRESH_MS = 62_000;
const STALE_SECONDS = 600;
const CACHE_KEY = 'https://cache.invalid/buses';
// Greater Dublin, so the response stays small.
const AREA = { south: 52.9, north: 53.7, west: -6.7, east: -5.9 };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function loadBuses(env) {
  const response = await fetch(FEED, { headers: { 'x-api-key': env.NTA_API_KEY } });
  if (!response.ok) throw new Error(`The bus feed answered ${response.status}.`);
  const buses = parseVehicles(await response.arrayBuffer())
    .filter(bus => bus.lat >= AREA.south && bus.lat <= AREA.north && bus.lon >= AREA.west && bus.lon <= AREA.east);
  return { updated: Date.now(), buses };
}

export async function busResponse(request, env, url) {
  if (url.pathname !== '/api/buses') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (!env.NTA_API_KEY) return json({ error: 'Live bus data is not set up. Add the NTA_API_KEY secret.' }, 503);

  const cache = caches.default;
  const cached = await cache.match(CACHE_KEY);
  const stored = cached ? await cached.json() : null;
  if (stored && Date.now() - stored.updated < FRESH_MS) return json(stored);
  try {
    const fresh = await loadBuses(env);
    await cache.put(CACHE_KEY, new Response(JSON.stringify(fresh), { headers: { 'Cache-Control': `max-age=${STALE_SECONDS}` } }));
    return json(fresh);
  } catch (error) {
    console.error(error);
    if (stored) return json({ ...stored, stale: true });
    return json({ error: 'Could not load live bus data. Please try again.' }, 502);
  }
}
