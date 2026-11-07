# Bus lab — plan (draft)

A separate, hands-on workspace in this repo for writing the live Dublin bus map
by hand. Not a course player: no video, no accounts, no auto-grader, no code
execution service. You edit files in your editor, the page reloads, and the map
either works or it doesn't. The browser is the test.

## Why the bus viewer

- Small enough to hold in one head, real enough to stay interesting: live feed,
  filters, polling, failure states, a visual result.
- The finished implementation already exists — [public/buses.js](../public/buses.js),
  [bus-feed.js](../bus-feed.js), [bus-api.js](../bus-api.js) — so there is always
  a reference when you're stuck.
- It has an obvious definition of done: buses move.

## Separation from the notebook

- Top-level `lab/`. The notebook does not import it, the sidebar does not link
  it, and it shares no browser modules with `worker.js`. The one exception is
  the dev proxy, which reuses the production protobuf reader (`bus-feed.js`) so
  the lab does not carry a second copy.
- `/buses.html` stays as the finished "golden" build. The lab makes its own copy.
  If the lab becomes better than the golden build, we promote it later.
- Local only at first. If it gets deployed, it gets its own static target, not a
  route inside the notebook app.

## Two ways to learn, and a recommended mix

**A. Rebuild** — write the viewer from scratch in eight stages. This is where the
JavaScript learning happens: modules, fetch, events, Maps, the DOM, timers.

**B. Extend** — keep a working viewer and add one feature at a time (route
shapes, stop markers, favourites, clustering). This is where motivation lives and
where debugging real code happens.

**Recommended: rebuild the core (stages 0–7), then extend the result (track B).**
The rebuild is short and covers the language; the extension track never ends and
is where you actually get good. Skipping the rebuild is fine if it feels like
busywork — the plan works either way.

## Layout

```
lab/
  PLAN.md                 this file
  README.md               how to run it
  index.html              the guide: stage list, tasks, preview
  lab.css
  lab.js                  renders stages, saves ticks in localStorage
  stages.js               stage data: goal, concepts, tasks, acceptance, hints
  app/
    index.html            the map page — the thing you write
    app.js                starts as a skeleton full of TODOs
    buses.css
  vendor/leaflet/         Leaflet copied in locally (no CDN)
  fixtures/vehicles.json  one real /api/buses payload, captured
  reference/              peek-when-stuck copies, frozen at v1
  dev.mjs                 local server + NTA proxy
```

## The loop

1. Open the guide, read the current stage.
2. Write the code in `lab/app/`.
3. Save. The dev server reloads the preview.
4. Check the acceptance list by hand. Tick the stage when it is true.
5. Stuck for 15 minutes? Open that stage's reference and compare. Close it again.

Progress is `localStorage` on the guide page, with a reset button. No database.

## Three data modes

| Mode | Used by | What it means |
| --- | --- | --- |
| Fixture | stages 1–4 | `fixtures/vehicles.json` checked in. No key, no network, deterministic. |
| Live proxy | stages 5–7 | `dev.mjs` holds `NTA_API_KEY` server-side, caches 62 s, serves `/api/buses` with the same shape as production. |
| No key | always | The proxy answers `503` and the page must say so politely. That is a feature, not a bug. |

The browser never sees the NTA key. That is the same reason the production
Worker exists, and stage 8 is where you write that proxy yourself.

## The guide page

- Left rail: stages 0–7 with ticks and a count (`3 / 8`).
- Centre: goal, "you'll learn", numbered tasks, acceptance checklist,
  collapsible hint, collapsible reference.
- Right: an iframe of `lab/app/` with a refresh button, so instructions and
  result sit side by side.
- Keyboard: `[` and `]` move between stages.

If the iframe feels like babysitting, open `lab/app/` in a second tab and use the
guide as a checklist. Same content.

## Rebuild stages

| # | Stage | You build | You learn | Done when |
| --- | --- | --- | --- | --- |
| 0 | The map | Page, vendored Leaflet, styles, one hard-coded marker | Module scripts, DOM, asset paths | Dublin is on screen with a marker at 53.3498, −6.2603 |
| 1 | Buses from data | Fetch the fixture, one marker per bus, route text | `fetch`, JSON, `map`, template literals, `divIcon` | One label per vehicle, no hard-coded IDs |
| 2 | Route names | Load `bus-routes.json`, turn `1 1 e a` into `1` and an operator | Objects, `Map`, optional chaining | Markers show `46A`, not `1 46A e a`; tooltip names the operator |
| 3 | Filters | Route input and operator `<select>`, re-render on input | Events, filtering, empty states | Typing `46A` and picking Dublin Bus both narrow the map |
| 4 | Marker diffing | Keep markers by ID; move, relabel, remove | `Map`, DOM identity, cleanup | A refresh updates positions without flicker or duplicates |
| 5 | Polling | 60 s timer, pause when hidden, resume on focus | `setInterval`, `visibilitychange`, stale data | Buses update on their own; a background tab does not hammer the feed |
| 6 | Failure | 503, 429, malformed JSON: keep the last good data | `try`/`catch`, error states, status text | Pulling the key breaks the page gracefully and says why |
| 7 | Polish | `aria-live`, phone layout, attribution, no layout shift | Accessibility, media queries, performance | Usable at 360 px wide with a screen reader announcing the count |

The last day of a stage is a commit. `git log` is the progress record.

## Optional stages

| # | Stage | You build | You learn |
| --- | --- | --- | --- |
| 8 | The proxy | `dev.mjs`: read `.dev.vars`, call NTA, cache 62 s | Node `http`, secrets, caching, CORS |
| 9 | The decoder | Protobuf by hand: varint, wire types, nested messages | Binary formats, `DataView`, offset arithmetic |

Stage 9 is the hardest and the most satisfying. [bus-feed.js](../bus-feed.js) is
the reference, and `node --test` can check it.

## Extension track (after the rebuild)

Each is an independent feature on a working map, one commit each:

- Route shapes from the GTFS static feed, drawn under the markers.
- Stop markers and a "next bus" panel for a chosen stop.
- Favourites: pin routes, survive reload.
- Clustering when zoomed out.
- A bus detail popup: route, trip, last seen.
- A short trail per bus from the last few polls.
- Offline: show the last successful payload with an age label.

Each gets a spec, acceptance criteria, and a reference diff in `stages.js`.

## Multi-language later

The spec is fixed, so the same pipeline can be rebuilt elsewhere. Not now, but
the shape is already there:

- **Python** — `fixtures/vehicles.json` → manual varint parser → filtered list →
  a tiny `http.server` page or terminal output. Good `bytes` and `struct` work.
- **Go** — structs, interfaces for "a bus source", goroutines for polling.

Each track reuses the fixture and the acceptance criteria. Nothing is shared with
the JS track except the spec.

## Tests you write yourself

Pure functions are worth testing by hand with `node --test`:

- `label(route)` and `operator(route)` against fixture routes.
- The filter predicate.
- The marker diff: given old and new buses, which markers move, which die.

These are the first tests you write, not the last. They live in `lab/app/*.test.mjs`.

## Non-goals

- Video, accounts, XP, streaks, leaderboards.
- An in-browser code editor or a grading backend.
- A second database. `localStorage` is enough.
- Deploying the lab. Local until it is better than the golden build.

## Decisions to make before building

1. **Rebuild, extend, or both?** Recommended: both, in that order.
2. **Local runner:** `node dev.mjs` (no auth, no Worker, teaches the proxy) or
   `wrangler dev` (same origin as the notebook, you sign in once). Recommended:
   `node dev.mjs`.
3. **Guide with an iframe preview, or plain docs + a second tab?** Recommended:
   iframe.
