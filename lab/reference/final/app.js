// The finished build, for orientation. It is deliberately plain: one fetch
// function, one render function, and a map that survives a failing feed.
// Yours does not have to look like this. It has to pass the stage checklist.

const params = new URLSearchParams(location.search);
const SOURCE = params.has('fixture') ? '/fixtures/vehicles.json' : '/api/buses';
const ROUTES = '/fixtures/bus-routes.json';
const REFRESH_MS = 60_000;
const DUBLIN_BUS = '1';

const $ = selector => document.querySelector(selector);
const status = $('#status');
const routeInput = $('#route');
const operatorSelect = $('#operator');
const markers = new Map();

let routes = { agencies: {}, routes: {} };
let buses = [];
let updated = 0;
let lastError = '';

const map = L.map('map', { zoomControl: false }).setView([53.3498, -6.2603], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function say(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

const label = route => routes.routes[route]?.[0] || route || '?';
const operator = route => routes.routes[route]?.[2] || '';
const operatorName = route => routes.agencies[operator(route)] || '';

function makeIcon(text) {
  return L.divIcon({
    className: 'bus-marker',
    html: `<span>${text}</span>`,
    iconSize: [Math.max(30, text.length * 8 + 12), 18],
  });
}

function render() {
  const wanted = routeInput.value.trim().toLowerCase();
  const agency = operatorSelect.value;
  const visible = buses.filter(bus =>
    (!agency || operator(bus.route) === agency) &&
    (!wanted || label(bus.route).toLowerCase() === wanted));

  const seen = new Set();
  for (const bus of visible) {
    seen.add(bus.id);
    const text = label(bus.route);
    let marker = markers.get(bus.id);
    if (!marker) {
      marker = L.marker([bus.lat, bus.lon], { keyboard: false, icon: makeIcon(text) }).addTo(map);
      marker.getElement().title = `${text} · ${operatorName(bus.route)}`;
      markers.set(bus.id, marker);
    }
    marker.setLatLng([bus.lat, bus.lon]);
  }
  for (const [id, marker] of markers) {
    if (!seen.has(id)) { marker.remove(); markers.delete(id); }
  }

  const age = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  const count = `${visible.length} ${visible.length === 1 ? 'bus' : 'buses'}`;
  const text = `${count} · updated ${age === null ? '–' : `${age}s`} ago`;
  say(lastError || text, Boolean(lastError));
}

async function refresh() {
  try {
    const response = await fetch(SOURCE);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load buses.');
    buses = data.buses;
    updated = data.updated || Date.now();
    lastError = data.stale ? 'The feed is unavailable. Showing the last positions it sent.' : '';
    render();
  } catch (error) {
    lastError = error.message;
    say(error.message, true);
  }
}

try {
  routes = await (await fetch(ROUTES)).json();
} catch { /* routes fall back to their raw IDs */ }
operatorSelect.append(new Option('All operators', ''));
for (const [id, name] of Object.entries(routes.agencies)) {
  if (id !== '10000' && id !== 'IR') operatorSelect.append(new Option(name, id));
}
operatorSelect.value = DUBLIN_BUS;

routeInput.addEventListener('input', render);
operatorSelect.addEventListener('change', render);
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (buses.length) render(); }, 5000);

await refresh();
