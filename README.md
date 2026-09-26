# web-obsidian

A password-protected notebook with a time tracker, at https://obsidian.ibraim.ie.

One Cloudflare Worker, one D1 database, no build step. Everything is in
`worker.js` and `public/`.

## Notes

- Markdown source on the left, live preview on the right.
- Tab indents. An indented list line nests under the line above it, and an
  indented paragraph keeps its indent in the preview.
- Autosave. ⌘S saves now, ⌘B and ⌘I wrap the selection.
- ⌘L turns the current line into a task (`- [ ]`) or flips it between done
  and not done. Click a check box in the preview to flip it there.
- Tick **Focus** to show only the Markdown, the preview and the timer. The
  choice stays after a reload, until you untick it.
- Tick **Compact** to fold the day headings (`### 9/11`) of earlier weeks into
  one line per week, in the preview and in the source. The source shows only
  the current week; the earlier weeks stay in the note and save with it.
- Double-click a title to rename. Deleted notes go to Trash.
- A version check rejects a save that would overwrite someone else's edit.

## Images

- Click **Image**, paste a screenshot, or drop images into the editor or preview.
- PNG, JPEG, WebP and GIF are supported. Large still images (up to 20 MB input)
  are resized to fit the 1.5 MB storage limit; GIFs must already fit that limit.
- Images appear in the preview; click to enlarge and press Escape to close.
  Edit the text in `![caption](url)` to change the caption, or leave it empty.
- Uploads are stored separately in D1 and served only to signed-in users.
  Removing a Markdown link hides the image; the stored image is retained so
  other notes and undo can still reference it.
- Existing databases need `migrations/0004_add_images.sql` before deployment.

## Time tracker

- Type a task, press Start. One entry runs at a time.
- Totals for today, this week and this month sit under the clock. Click them
  for the report: a bar per day, and every entry of the month, editable.
  Escape, **Back to notes**, or a click on a note closes the report.
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

A push to `main` runs `.github/workflows/deploy.yml`. The workflow applies
the migrations it lists, then deploys the Worker. It needs one repository
secret, `CLOUDFLARE_API_TOKEN`, with the Workers Scripts and D1 edit
permissions. Add a new migration file to the workflow list when you add one.

To deploy by hand instead:

```sh
npx wrangler secret put PASSWORD     # once
npx wrangler d1 execute ibraim-obsidian-notes --remote --file migrations/0004_add_images.sql   # or whichever is new
npx wrangler deploy
```

Sessions are a signed cookie, 12 hours. Failed sign-ins slow down after
the third attempt.
