// The lab's course content. Everything the guide renders comes from here.
//
// A stage is one working increment: a goal, the ideas it teaches, the tasks that
// produce it, and a checklist you hold yourself to. Nothing is graded. If the
// page does what "Done when" says, the stage is done.

export const STAGES = [
  {
    id: 'map',
    title: 'The map',
    goal: 'Put Dublin on the screen with one hard-coded marker. No data yet — this is the canvas.',
    learn: ['ES modules', 'Leaflet basics', 'absolute positioning'],
    tasks: [
      'Open lab/app/index.html and lab/app/app.js. Note the <script type="module"> and that Leaflet is loaded before it.',
      'Create the map inside #map, centred on 53.3498, −6.2603 at zoom 12.',
      'Add an OpenStreetMap tile layer with attribution. The map is grey until you do.',
      'Add one marker at O’Connell Bridge, with a popup.',
      'Reload the preview. If there are scrollbars, #map is not filling the window — that is a CSS task.',
    ],
    done: [
      'The map fills the preview with no scrollbars.',
      'Dublin is recognisable and the marker sits on O’Connell Bridge.',
      'The browser console has no errors.',
      'Panning and zooming work.',
    ],
    hint: 'Leaflet is vendored at /vendor/leaflet/, and the page already loads it. You do not need a <script> tag — just use L. The tile URL is https://tile.openstreetmap.org/{z}/{x}/{y}.png.',
    snippet: `const map = L.map('map').setView([53.3498, -6.2603], 12);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

L.marker([53.3498, -6.2603]).addTo(map).bindPopup('O’Connell Bridge');`,
  },
  {
    id: 'buses',
    title: 'Buses from data',
    goal: 'Draw the buses in the fixture instead of one marker. The data is real, captured from the live feed.',
    learn: ['fetch and await', 'JSON shape', 'map()', 'template literals', 'L.divIcon'],
    tasks: [
      'Fetch ../fixtures/vehicles.json. It has the same shape as the live API: { updated, buses: [...] }.',
      'console.log the payload. Find one bus and note id, route, lat, lon, bearing, time.',
      'For each bus, build a small L.divIcon whose HTML is the route text, and add a marker at its lat/lon.',
      'Show how many buses there are in #status.',
      'Delete the single marker from stage 0 — it is now lying.',
    ],
    done: [
      'Fourteen markers appear around the city, each labelled.',
      'Every marker comes from the file; nothing is hard-coded.',
      'A bus with a missing field does not crash the page.',
      'The status line says how many buses are shown.',
    ],
    hint: 'The fixture is at /fixtures/vehicles.json, but app.js lives in /app/, so the relative path is ../fixtures/vehicles.json. Use await at the top level of a module — it is allowed.',
    snippet: `const response = await fetch('../fixtures/vehicles.json');
const data = await response.json();

for (const bus of data.buses) {
  const icon = L.divIcon({
    className: 'bus-marker',
    html: bus.route,
    iconSize: [40, 18],
  });
  L.marker([bus.lat, bus.lon], { icon }).addTo(map);
}`,
  },
  {
    id: 'names',
    title: 'Route names',
    goal: 'Turn the feed’s route IDs into the numbers people actually read, and name the operator.',
    learn: ['objects and Maps', 'optional chaining', 'data normalisation'],
    tasks: [
      'Fetch ../fixtures/bus-routes.json. Look at why the route IDs are shaped the way they are: "1 39 c a".',
      'Write label(route): return routes.routes[route]?.[0] or the raw route as a fallback.',
      'Write operator(route): look up routes.routes[route]?.[2], then routes.agencies[that]?.',
      'Use label() for the marker text and operator() in the tooltip.',
      'Reload: the markers now say 1, 39, 16 instead of 1 39 c a.',
    ],
    done: [
      'Every marker shows a short route number.',
      'A route missing from the table shows its raw ID rather than "undefined".',
      'Hovering a marker names the route and the operator.',
    ],
    hint: 'The route table is 402 entries keyed by the feed’s composite ID. routes.routes[key][0] is the short name, [1] is the description, [2] is the agency ID. routes.agencies maps agency IDs to company names.',
    snippet: `const label = route => routes.routes[route]?.[0] || route || '?';
const operator = route => routes.agencies[routes.routes[route]?.[2]] || '';`,
  },
  {
    id: 'filters',
    title: 'Filters',
    goal: 'Let yourself narrow the map to one route, or one operator, without reloading.',
    learn: ['DOM events', 'filter()', 'empty states', 'generating <option>s'],
    tasks: [
      'Add a route <input> and an operator <select> to index.html. Give both a real <label> (visually hidden is fine).',
      'Fill the select from routes.agencies. Skip LUAS and Irish Rail — they are not buses.',
      'Write render(): start from all buses, filter by the typed label (case-insensitive exact match) and by operator.',
      'Call render() on input and change. Do not refetch the fixture.',
      'Show "No buses match" when the filter empties the map.',
    ],
    done: [
      'Typing 16 narrows the map to route 16 only.',
      'Choosing Dublin Bus hides Go-Ahead and Bus Éireann.',
      'Clearing both brings every bus back.',
      'The count in #status follows the filter.',
    ],
    hint: 'Keep the last payload in a module-level variable. render() should be a pure pass over that array — fetch happens once, rendering happens many times.',
    snippet: `const wanted = input.value.trim().toLowerCase();
const agency = select.value;

const visible = buses.filter(bus =>
  (!agency || operator(bus.route) === agency) &&
  (!wanted || label(bus.route).toLowerCase() === wanted)
);`,
  },
  {
    id: 'diff',
    title: 'Marker diffing',
    goal: 'Update markers instead of recreating them, so a refresh moves buses rather than rebuilding the world.',
    learn: ['Map', 'DOM identity', 'cleanup', 'why flicker happens'],
    tasks: [
      'Keep a Map from bus id to marker at module scope.',
      'On each render: for a bus you have seen, setLatLng and update its label. For a new one, create it.',
      'Remove markers for buses that are gone or filtered out — and delete them from the Map.',
      'Log "created N, moved M, removed K" once to prove it is reusing.',
      'Run render() twice with the same filter: it must not duplicate anything.',
    ],
    done: [
      'Re-rendering does not add duplicate markers.',
      'Filtering away and back restores each bus exactly once.',
      'Surviving markers visibly move, not blink.',
    ],
    hint: 'A L.Marker has setLatLng, and its element is marker.getElement(). If you replace the inner text, keep a reference to the element rather than re-reading it every render.',
    snippet: `const markers = new Map();

for (const bus of visible) {
  let marker = markers.get(bus.id);
  if (!marker) {
    marker = L.marker([bus.lat, bus.lon], { icon: makeIcon(label(bus.route)) }).addTo(map);
    markers.set(bus.id, marker);
  }
  marker.setLatLng([bus.lat, bus.lon]);
}

for (const [id, marker] of markers) {
  if (!seen.has(id)) { marker.remove(); markers.delete(id); }
}`,
  },
  {
    id: 'live',
    title: 'Polling and the real feed',
    goal: 'Refresh on a timer against the proxy, and stop the timer when the tab is hidden.',
    learn: ['setInterval', 'visibilitychange', 'top-level await', 'age labels'],
    tasks: [
      'Change the source from the fixture to /api/buses. Run the dev server with an NTA_API_KEY in .dev.vars — see lab/README.md.',
      'Call refresh() every 60 seconds with setInterval.',
      'Inside the tick, skip the fetch when document.hidden. Listen to visibilitychange and refresh once when the tab comes back.',
      'Show "updated Ns ago" in the status line, using the updated field.',
      'Keep render() separate from refresh() — the timer calls refresh, the filters call render.',
    ],
    done: [
      'Buses move about every minute on their own.',
      'A background tab does not keep polling (watch the dev server log).',
      'The status line shows an age that resets on refresh.',
      'The first paint happens without waiting for a timer.',
    ],
    hint: 'The dev proxy caches the NTA feed for 62 seconds, so polling every 60 s hits your own cache most of the time. NTA allows one request per minute per key; do not poll faster.',
    snippet: `setInterval(() => {
  if (!document.hidden) refresh();
}, 60_000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});`,
  },
  {
    id: 'failure',
    title: 'Failure is the normal case',
    goal: 'Keep the last good buses on screen when the feed fails, and say what happened.',
    learn: ['try/catch', 'error states', 'stale vs missing', 'unhandled rejections'],
    tasks: [
      'Run the dev server with no NTA_API_KEY. It answers 503 — handle it, do not let it throw.',
      'Try a network error too: stop the server mid-poll and restart it.',
      'On failure: keep the markers, colour the status red, and keep showing the last successful age.',
      'Distinguish "never loaded" (no buses yet) from "stale" (buses, but the last poll failed).',
      'Recover automatically on the next successful poll, without a reload.',
    ],
    done: [
      'Killing the key leaves the map intact with a readable error.',
      'Restarting the server recovers without a reload.',
      'The console shows no unhandled promise rejections.',
      'The error clears itself on success.',
    ],
    hint: 'response.ok is false for 4xx and 5xx, but fetch only rejects on network failure — so check ok explicitly. Keep a lastGood timestamp separately from the payload’s updated field.',
    snippet: `try {
  const response = await fetch(SOURCE);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load buses.');
  buses = data.buses;
  updated = data.updated;
  render();
  say(\`\${buses.length} buses · updated \${age()}s ago\`);
} catch (error) {
  say(error.message, true);
}`,
  },
  {
    id: 'polish',
    title: 'Polish',
    goal: 'Make it usable on a phone, with a screen reader, and honest about where the data comes from.',
    learn: ['aria-live', 'media queries', 'attribution', 'performance'],
    tasks: [
      'Put role="status" aria-live="polite" on the status line so the count is announced.',
      'Add a media query: under 640 px, turn the control panel into a bar and let the map keep the rest.',
      'Add attribution for OpenStreetMap and the National Transport Authority, as links.',
      'Check the page at 360 px wide and with the keyboard only.',
      'Profile one refresh: only markers whose position changed should touch the DOM.',
    ],
    done: [
      'At 360 px the controls are still readable and the map is still usable.',
      'A screen reader announces the bus count when it changes.',
      'Attribution is visible without being in the way.',
      'Nothing jumps around when the count text changes length.',
    ],
    hint: 'Reserve space for the status line (min-width or a fixed height) so "9 buses" and "14 buses" do not shift the panel. That is the layout-shift task, and it is the one people skip.',
    snippet: `@media (max-width: 640px) {
  .panel { left: 8px; right: 8px; bottom: 8px; }
  #map { inset: 0 0 96px 0; }
}`,
  },
];

export const OPTIONAL_STAGES = [
  {
    id: 'proxy',
    title: 'The proxy, by hand',
    goal: 'Write lab/dev.mjs’s /api/buses route yourself: Node http, a secret from .dev.vars, and a 62-second cache.',
    learn: ['node:http', 'secrets in .env files', 'server-side caching', 'why keys stay off the client'],
    tasks: [
      'Read lab/dev.mjs. Then write your own version in a scratch file.',
      'Serve /api/buses by calling the NTA feed with x-api-key.',
      'Read the key from .dev.vars at startup — never from the browser.',
      'Cache the parsed payload for 62 seconds and serve the cache on a hit.',
      'Return 503 with a clear message when the key is missing.',
    ],
    done: [
      'One request per minute reaches NTA, not one per browser refresh.',
      'The key never appears in a response or in app.js.',
      'A missing key is a friendly 503, not a crash.',
    ],
    hint: 'The production version is bus-api.js at the repo root. Read it only after you have a first draft — the parsing is in bus-feed.js.',
    snippet: '',
  },
  {
    id: 'decoder',
    title: 'Decode the protobuf by hand',
    goal: 'Replace bus-feed.js with your own reader for the GTFS-Realtime feed: varints, wire types, nested messages.',
    learn: ['binary formats', 'DataView', 'little-endian floats', 'offset arithmetic', 'node --test'],
    tasks: [
      'Fetch one Vehicles.pb payload and save it to lab/fixtures/vehicles.pb.',
      'Write varint(): read 7 bits at a time until the high bit is clear.',
      'Read the envelope: field 2 is an entity, field 4 is a vehicle.',
      'Pull out trip.route_id (1.5), position lat/lon/bearing (2.1–2.3), and vehicle id (8.1).',
      'Write a node --test that compares your parser with the fixture payload.',
    ],
    done: [
      'Your parser produces the same buses as bus-feed.js.',
      'A truncated buffer throws instead of looping forever.',
      'The test passes from the command line.',
    ],
    hint: 'bus-feed.js is 77 lines and is the reference. Do not open it until your parser returns something plausible but wrong — that is the useful moment.',
    snippet: '',
  },
];

export const EXTENSIONS = [
  { title: 'Route shapes', detail: 'Draw each route’s polyline under the markers, from the GTFS static feed.' },
  { title: 'Stops and next bus', detail: 'Click a stop, see the next arrivals; needs the TripUpdates feed.' },
  { title: 'Favourites', detail: 'Pin routes, persist them in localStorage, sort them to the top.' },
  { title: 'Clustering', detail: 'Group markers when zoomed out so the city stays readable.' },
  { title: 'Bus detail', detail: 'A popup with route, trip, bearing and the last time it was seen.' },
  { title: 'Trails', detail: 'Keep the last few positions per bus and draw a short path.' },
  { title: 'Offline honesty', detail: 'Show the last successful payload with a clear age when the network is gone.' },
];
