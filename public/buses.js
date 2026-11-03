const REFRESH_MS = 60_000;
const DUBLIN_BUS = '1';
const $ = selector => document.querySelector(selector);
const status = $('#bus-status');
const routeInput = $('#bus-route');
const operatorSelect = $('#bus-operator');
const markers = new Map();
let routes = { agencies: {}, routes: {} };
let buses = [];
let updated = 0;

const map = L.map('bus-map', { zoomControl: false }).setView([53.3498, -6.2603], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Data: <a href="https://www.nationaltransport.ie">NTA</a>',
}).addTo(map);

function say(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}
const label = route => routes.routes[route]?.[0] || route || '?';
const operator = route => routes.routes[route]?.[2] || '';

function render() {
  const wanted = routeInput.value.trim().toLowerCase();
  const agency = operatorSelect.value;
  const visible = buses.filter(bus => (!agency || operator(bus.route) === agency) && (!wanted || label(bus.route).toLowerCase() === wanted));
  const seen = new Set();
  for (const bus of visible) {
    seen.add(bus.id);
    const text = label(bus.route);
    let marker = markers.get(bus.id);
    if (!marker) {
      marker = L.marker([bus.lat, bus.lon], { keyboard: false, icon: L.divIcon({ className: 'bus-marker', html: '<span></span>', iconSize: [Math.max(30, text.length * 8 + 12), 18] }) });
      marker.addTo(map);
      marker.getElement().firstChild.textContent = text;
      markers.set(bus.id, marker);
    }
    marker.setLatLng([bus.lat, bus.lon]);
    marker.getElement().title = `${text} · ${routes.routes[bus.route]?.[1] || ''}`.trim();
  }
  for (const [id, marker] of markers) if (!seen.has(id)) { marker.remove(); markers.delete(id); }
  say(`${visible.length} ${visible.length === 1 ? 'bus' : 'buses'} · updated ${updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : '–'}s ago`);
}

async function refresh() {
  try {
    const response = await fetch('/api/buses');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load buses.');
    buses = data.buses;
    updated = data.updated;
    render();
  } catch (error) { say(error.message, true); }
}

try {
  routes = await (await fetch('/bus-routes.json')).json();
} catch { /* routes then show as their raw identifiers */ }
operatorSelect.append(new Option('All operators', ''));
for (const [id, name] of Object.entries(routes.agencies)) if (id !== '10000' && id !== 'IR') operatorSelect.append(new Option(name, id));
operatorSelect.value = DUBLIN_BUS;
routeInput.addEventListener('input', render);
operatorSelect.addEventListener('change', render);
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
setInterval(() => { if (buses.length) render(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
await refresh();
