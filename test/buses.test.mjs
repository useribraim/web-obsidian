import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVehicles } from '../bus-feed.js';
import { busResponse } from '../bus-api.js';

const encoder = new TextEncoder();
const varint = number => { const out = []; while (number > 127) { out.push((number % 128) | 128); number = Math.floor(number / 128); } out.push(number); return out; };
const tag = (field, wire) => varint(field * 8 + wire);
const text = (field, value) => { const bytes = encoder.encode(value); return [...tag(field, 2), ...varint(bytes.length), ...bytes]; };
const message = (field, bytes) => [...tag(field, 2), ...varint(bytes.length), ...bytes];
const float = (field, value) => [...tag(field, 5), ...new Uint8Array(new Float32Array([value]).buffer)];
const number = (field, value) => [...tag(field, 0), ...varint(value)];

function entity(id, { route, lat, lon, bearing, time, vehicle }) {
  const position = lat === undefined ? [] : message(2, [...float(1, lat), ...float(2, lon), ...float(3, bearing)]);
  const body = [...message(1, [...text(1, 'trip-' + id), ...text(5, route)]), ...position, ...number(5, time), ...message(8, text(1, vehicle))];
  return message(2, [...text(1, id), ...message(4, body)]);
}
const feed = entities => new Uint8Array([...message(1, text(1, '2.0')), ...entities.flat()]);

test('the feed reader returns positioned vehicles with their routes', () => {
  const buses = parseVehicles(feed([
    entity('a', { route: '1_46A', lat: 53.3498, lon: -6.2603, bearing: 90, time: 1793716444, vehicle: 'bus-1' }),
    entity('b', { route: '1_15', time: 1, vehicle: 'bus-2' }),
  ]).buffer);
  assert.equal(buses.length, 1);
  assert.deepEqual(buses[0], { id: 'bus-1', route: '1_46A', lat: 53.3498, lon: -6.2603, bearing: 90, time: 1793716444 });
  assert.throws(() => parseVehicles(new Uint8Array([0x12, 0x40, 1]).buffer));
});

test('the bus route needs a key, filters to Dublin, and shares a cached copy', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async match(key) { return store.has(key) ? new Response(store.get(key)) : undefined; },
    async put(key, response) { store.set(key, await response.text()); },
  } };
  const url = new URL('https://obsidian.ibraim.ie/api/buses');
  const ask = env => busResponse(new Request(url), env, url);
  assert.equal((await ask({})).status, 503);

  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (address, options) => {
    calls++;
    assert.equal(options.headers['x-api-key'], 'secret');
    return new Response(feed([
      entity('a', { route: '1_46A', lat: 53.35, lon: -6.26, bearing: 0, time: 1, vehicle: 'dublin' }),
      entity('b', { route: '2_X', lat: 51.9, lon: -8.47, bearing: 0, time: 1, vehicle: 'cork' }),
    ]));
  };
  try {
    const first = await (await ask({ NTA_API_KEY: 'secret' })).json();
    assert.deepEqual(first.buses.map(bus => bus.id), ['dublin']);
    await ask({ NTA_API_KEY: 'secret' });
    assert.equal(calls, 1);
    store.set('https://cache.invalid/buses', JSON.stringify({ ...first, updated: Date.now() - 70_000 }));
    globalThis.fetch = async () => new Response('no', { status: 429 });
    assert.equal((await (await ask({ NTA_API_KEY: 'secret' })).json()).stale, true);
  } finally { globalThis.fetch = original; delete globalThis.caches; }
  assert.equal(await busResponse(new Request('https://x/api/other'), {}, new URL('https://x/api/other')), null);
});
