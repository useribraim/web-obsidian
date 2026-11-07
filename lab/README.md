# Bus lab

A hands-on workspace for writing the live Dublin bus map from scratch, one
stage at a time. It is deliberately not a course player: you edit files, the
preview reloads, and the map either works or it doesn't.

The plan and the reasoning are in [PLAN.md](PLAN.md).

## Run it

```sh
npm run lab
```

Then open http://127.0.0.1:8788/. The guide is on the left, your map is on the
right, and the map is `lab/app/` — the files you edit.

For live buses, put an NTA key in the repo's `.dev.vars` (the same file the
notebook uses for `PASSWORD`):

```sh
echo "NTA_API_KEY=your-key" >> .dev.vars
```

Without a key the server still runs; `/api/buses` answers `503` and the fixture
still works. NTA issues keys at https://developer.nationaltransport.ie/.

## What is where

| Path | What it is |
| --- | --- |
| `app/` | **Yours.** `index.html` and `app.js`, starting nearly empty. |
| `stages.js` | The guide's content: goals, tasks, checklists, hints. |
| `index.html`, `lab.js`, `lab.css` | The guide page itself. |
| `fixtures/vehicles.json` | One real `/api/buses` payload. Fourteen buses, no key needed. |
| `fixtures/bus-routes.json` | The 402-route lookup table, copied from `public/`. |
| `reference/final/` | The finished build, for orientation when stuck. Open `/reference/final/` (add `?fixture` to work without a key). |
| `vendor/leaflet/` | Leaflet 1.9.4, vendored so the lab works without the CDN. |
| `dev.mjs` | The local server and the NTA proxy. Optional stage 8. |

## The loop

1. Read the stage in the guide.
2. Change something in `app/`.
3. Refresh the preview (the guide has a button; the iframe is same-origin).
4. Check the "Done when" list by hand.
5. Tick the stage. Stuck for 15 minutes? Open the hint, then the reference.

The guide stores ticks and the current stage in `localStorage`. Reset clears the
ticks only.

## Keyboard

- `[` and `]` move between stages.

## Notes

- The lab is local only. It is not deployed, it is not linked from the notebook,
  and nothing in it is imported by `worker.js`.
- `/buses.html` in the notebook repo is the finished golden build. The lab's
  `reference/final/` is a smaller readable version of the same behaviour.
- Stage 8 (the proxy) and stage 9 (the protobuf decoder) are optional. The
  production versions are `bus-api.js` and `bus-feed.js` at the repo root.
