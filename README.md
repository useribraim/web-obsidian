# web-obsidian

A password-protected notebook with a time tracker, at https://obsidian.ibraim.ie.

One Cloudflare Worker, one D1 database, no build step. Everything is in
`worker.js` and `public/`.

## Notes

- Markdown source on the left, live preview on the right.
- Autosave. ⌘S saves now, ⌘B and ⌘I wrap the selection.
- Double-click a title to rename. Deleted notes go to Trash.
- A version check rejects a save that would overwrite someone else's edit.

## Time tracker

- Type a task, press Start. One entry runs at a time.
- Totals for today, this week and this month sit under the clock. Click them
  for the report: a bar per day, and every entry of the month, editable.
- The page sends a heartbeat every 5 minutes. If the laptop sleeps and the
  heartbeats stop for 15 minutes, the entry ends at the last one.

## Run locally

```sh
echo "PASSWORD=anything" > .dev.vars
npx wrangler d1 execute ibraim-obsidian-notes --local --file schema.sql
npx wrangler dev
```

An existing local database needs the files in `migrations/` instead of
`schema.sql`, in order.

## Deploy

```sh
npx wrangler secret put PASSWORD     # once
npx wrangler d1 execute ibraim-obsidian-notes --remote --file migrations/0003_add_seen_at.sql   # or whichever is new
npx wrangler deploy
```

Sessions are a signed cookie, 12 hours. Failed sign-ins slow down after
the third attempt.
