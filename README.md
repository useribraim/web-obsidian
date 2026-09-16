# Public notes

Minimal shared notebook at https://obsidian.ibraim.ie. Authenticated visitors can read, create, and edit notes. Edits autosave while you type (⌘S / Ctrl+S forces a save). The B/I buttons or ⌘B/⌘I wrap the selection in Markdown bold/italic; Tab inserts a tab character. Double-click a title in the sidebar to rename a note. Deleted notes move to Trash, where they can be restored or deleted forever.

The editor shows the Markdown source in a textarea beside a live preview pane, with an Edit / Split / Preview control in the toolbar: Edit shows only the source, Split shows both panes, and Preview shows only the rendered page. A Spell check tick turns the browser's spell checker on or off for the editor. Both choices are remembered in `localStorage`. The preview renders headings (`#`, `##`, `###`), bold, italic, strikethrough, inline and fenced code, bullet and numbered lists, blockquotes, horizontal rules, links and images. On narrow screens the Split option is hidden and the panes stack.

## Time tracker

The sidebar holds a stopwatch, in the style of Clockify. Type what you work on, then press Start or Enter. The clock runs until you press Stop. One entry runs at a time: starting a new entry stops the running one. A description typed while the clock runs is saved to the running entry. Entries persist in D1, so a running clock continues after a reload and shows on every device.

Under the clock, three totals show the time tracked today, this week (from Monday), and this month. Click them to open the report. The report shows the same totals, a bar for each day of the current week, and the entries of the current month grouped by day. Each finished entry has Edit, to correct the description, the start, or the stop, and Delete. Totals use the browser's local time zone. An entry that crosses midnight counts toward each day for the part inside it.

The whole site sits behind a sign-in page, matching tether.ibraim.ie. The Worker runs first for every request (`run_worker_first: true` in `wrangler.jsonc`) so the app shell and its assets are gated too, not just `/api/*`. Sessions last 12 hours in an HttpOnly, Secure, SameSite=Strict cookie. Repeated failed sign-ins are slowed down: the first three are free, then each further failure doubles the delay up to ten seconds.

The site uses a shared password configured as the Cloudflare Worker secret `PASSWORD`. The password is never stored in this repository.

Set the production password from this directory with:

```sh
npx wrangler secret put PASSWORD
```

Then deploy the Worker:

```sh
npx wrangler deploy
```

## Develop

From this directory:

```sh
npx wrangler d1 execute ibraim-obsidian-notes --local --file schema.sql
npx wrangler dev
```

If your local database was created before soft delete existed, run the migration once instead of the schema:

```sh
npx wrangler d1 execute ibraim-obsidian-notes --local --file migrations/0001_add_deleted_at.sql
```

If it was created before the time tracker existed, run:

```sh
npx wrangler d1 execute ibraim-obsidian-notes --local --file migrations/0002_add_time_entries.sql
```

## Migrate an existing database

```sh
npx wrangler d1 execute ibraim-obsidian-notes --remote --file migrations/0001_add_deleted_at.sql
```

```sh
npx wrangler d1 execute ibraim-obsidian-notes --remote --file migrations/0002_add_time_entries.sql
```

## Deploy

```sh
npx wrangler d1 execute ibraim-obsidian-notes --remote --file schema.sql
npx wrangler deploy
```

Notes persist in D1. Version checks reject conflicting saves from simultaneous editors. The frontend renders note titles as text and shows note content as Markdown source beside a live, HTML-escaped preview.
