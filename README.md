# web-obsidian

A password-protected notebook with a time tracker, at https://obsidian.ibraim.ie.

One Cloudflare Worker, one D1 database, no frontend build step. The site is in
`worker.js` and `public/`; `mcp.js` and `mcp-auth.js` provide agent access.

## Notebook MCP

**Agent connections** in the sidebar opens `/agents.html`. The notebook's remote
MCP endpoint is `https://obsidian.ibraim.ie/mcp`, using **Streamable HTTP**.
Agents and the browser use the same notes in D1. No separate agent runner,
model provider, or vector database is required.

### Connect a harness

- In a client that supports remote MCP and OAuth, add the endpoint URL. It will
  open the notebook's sign-in and consent page. Check the client name and the
  requested permissions before approving. A client name is self-reported, not
  proof that an application is trustworthy.
- For a harness that accepts custom HTTP headers, create a personal token in
  **Agent connections** and send `Authorization: Bearer <token>` to `/mcp`.
  Tokens are shown only once. Use the harness's secret store or environment
  variables; do not commit one to a configuration file or paste it into a note.
- MCP configuration formats differ by harness. The required settings are a
  remote HTTP server URL and either OAuth or a bearer authorization header.
  A stdio-only client needs a remote-MCP adapter; a bare model is not itself
  an MCP client. The deprecated standalone SSE transport is not provided.

### Permissions and tools

| Permission | Available tools |
| --- | --- |
| `notes:read` | `list_notes`, `search_notes`, `read_note` |
| `notes:create` | `create_note` |
| `notes:append` | `append_to_note` |
| `notes:edit` | `update_note` |

Permissions apply to **all active notes**, not selected notes or folders. Read
access is opt-in: the token form defaults to create-only access. Write-only
tools return metadata rather than existing note content. Append and edit need
a note ID; listing and discovering IDs requires Read or an ID supplied by you.
Editing also needs the current version, which can be obtained with Read.

Updates check the expected version and reject stale writes. Appends are atomic
and increment the version, so a browser with older content cannot silently
overwrite them. Existing note limits apply: 200 title characters and 200,000
content characters. Agent writes are attributed in `mcp_note_events`.
Trashed notes, deletion, images, books, files, the daily list, and the time
tracker are not exposed. The page may need to reopen a note to show an agent's
latest edit; this is not a collaborative live editor.

### Access lifecycle

- Personal tokens and OAuth access/refresh tokens are stored only as hashes.
- OAuth uses authorization codes with PKCE S256, exact registered redirect
  URIs, explicit consent, short-lived access tokens, and rotating refresh tokens.
  OAuth connections expire after 30 days; reconnect to renew consent. Detected
  refresh-token replay revokes the connection.
- Both personal tokens and OAuth grants appear in **Agent connections** and
  can be revoked independently. Revocation blocks subsequent requests, not
  work already in progress or copies of text already read by a client.
- Changing the notebook password does not revoke existing MCP connections.
  Revoke them separately if a harness or token is compromised.
- A request with an `Origin` header must come from this site's origin. Remote
  harnesses normally call from their backend or CLI without that header;
  direct cross-origin browser MCP calls are not enabled.
- Treat note text as untrusted reference material, not instructions that grant
  an agent additional authority. Only connect clients you trust. Do not place
  employer-confidential data here or send it to an external model unless your
  employer's policy explicitly permits it.

Existing databases need `migrations/0008_add_mcp.sql`; the deployment workflow
applies it before deploying. Install dependencies with `npm ci`. Run
`npm test` for protocol, authentication, persistence, and concurrency tests,
and `npm run check:worker` to check the Cloudflare bundle. Browser scenarios
are in `test/agents.browser.mjs` and use intercepted requests, not real tokens.
`test/mcp-oauth.browser.mjs` exercises native browser consent, code exchange,
refresh, and replay revocation against an isolated local Wrangler database.

## Notes

- The app opens in a dark theme. Choose **Light**, **Dark**, **Forest** or **Nord** with **Theme** in the **⋯** menu. The choice is remembered on this browser, including the sign-in page. The book reader keeps its own **Dark** / **Light** choice.

- The toolbar keeps the save status, the view buttons (**Edit**, **Live**, **Split**, **Preview**), the unravel arrow and **Image** in the open. A note saves by itself, so there is no Save button; ⌘S saves at once, and ⌘B and ⌘I still make bold and italic. The **⋯** menu holds **Focus mode**, **Theme**, **Spell check**, a **Markdown cheatsheet** and **Delete**. Delete still asks first.

- **Daily** in the sidebar, or ⌘J, shows a note that floats above every page. It lists the tasks you do every day. Ticks clear on each new day, and the list is stored in D1 (`daily_list`), so every device shows the same list. Drag the header to move the note.
- The box above the list searches titles and text. Each note shows when it was last edited. In **Edit** and **Preview** the text sits in a column of about 75 characters.

- Markdown source on the left, live preview on the right.
- Opening a note places the editor and preview at its latest dated heading. Notes without day headings start at the top.
- Tab indents. An indented list line nests under the line above it, and an
  indented paragraph keeps its indent in the preview.
- Autosave. ⌘S saves now, ⌘B and ⌘I wrap the selection.
- ⌘L turns the current line into a task (`- [ ]`) or flips it between done
  and not done. Click a check box in the preview to flip it there.
- **Live** edits the rendered note, as Obsidian's Live Preview does. The line with
  the caret shows its Markdown, and every other line shows the result. Click a check
  box to tick a task. The view is in `public/live-view.js` and `public/tokenizer.js`.
  The textarea stays the source of the note, so saving, folding and the shortcuts
  work as in **Edit**.
- Primary tasks use `- [ ] task`. For a secondary task, write `- [ ] > subtask`
  or indent a task with a tab or two spaces. Secondary tasks have smaller,
  indented checkboxes; the `>` stays in the source and is hidden in the preview.
  Each checkbox changes only its own task. A completed parent does not cross out
  unfinished subtasks. Click a task's text or its checkbox to tick it.
- Open the **⋯** menu and tick **Focus mode** to show only the Markdown, the preview and the timer. The
  choice stays after a reload, until you untick it.
- Notes with day headings open compact, every time. Only the last day stays
  open. Every earlier day waits in the **Earlier weeks** dropdown above the
  preview, grouped by month, with the days and open tasks of each week. Pick a
  week, or **All of** a month, to read it there, and **Close** to put it away. A
  month needs no heading of its own: it comes from the dates.
- The small arrow beside the view buttons unravels the whole note: every week and day
  in the preview, and every line in the editor. Click it again to fold. It is not
  remembered, so the next visit starts compact. The number of open days is
  `DAYS_SHOWN` in `public/weeks.js`.
  - The open day is the last day heading in the note, so the note
    looks the same on any day. A heading starts with a date: `9/28`, `28/9`,
    `01/10`, `9.28`, `9/28/2026`, `2026-10-01`, or a month in words such as
    `3 oct 2026`, `10 oct`, `Oct 3`, `Mon 5th October`, or a Russian month such as
    `31 октября` or `31 oktabrya`. Each date is read against the
    heading before it, so `01/10` after `9/30` is the 1st of October. Month first
    wins when both readings fit. A line in a fenced code block is not a heading.
  - **Still open** lists the tasks left open in earlier weeks, with the week each
    one came from. Tick one there and it is ticked in the note.
  - Lines above the first day heading, such as a title, count as earlier text:
    they fold with the first earlier week, in the source and in the preview. If
    a note has no earlier week, nothing is hidden.
  - The week you pick belongs to the note you picked it in.
  - Compact expects the newest day at the bottom. A note with the newest day at
    the top is shown in full. A heading that starts with a fraction, such as
    `1/2 cup`, is read as a date.
  - The source shows only the open days. A bar above it says how many earlier
    lines are hidden, and **Show all** shows them. They stay in the note and in
    every save.
- Double-click a title to rename. Deleted notes go to Trash.
- The **Trash** is the wire-mesh bin at the foot of the sidebar. It shows paper when it holds a note. Click it to see the trashed notes, and click **Back** to return.
- The **‹** button in the sidebar header folds the sidebar to a narrow rail, and **›** brings it back. ⌘\ (Ctrl+\) does the same. The choice is remembered.
- A version check rejects a save that would overwrite someone else's edit.

## Interview prep

- `prep.ibraim.ie` serves the standalone MCQ site (`public/prep.html`), using
  the same password and D1 notebook as the notes site. Sign in separately on
  each hostname. The custom domain is configured in `wrangler.jsonc`; publish
  it with `npm run deploy`.

- **Interview prep** in the sidebar (or mobile navigation) opens `#/interview`.
- Choose Python, C++, or a mixed round. Each round shuffles ten questions from
  a built-in bank of 40 covering Python 3 and C++17; this is not AI-generated
  and needs no model provider or API key.
- Filter by fundamentals or intermediate difficulty. Each language has ten
  questions at each level. After a round, **Practice missed questions** gives
  a separate retry drill with explanations, without changing the original
  score or saved note. Retry drills are temporary and reset on reload.
- **I don’t know — study later** records an unanswered question without guessing.
  It counts as not yet learned in the score and is included in mistake notes
  with a basics lesson and code example. **Study later** keeps flagged questions
  in this browser’s local storage across rounds and visits (not cross-device).
  Expand a lesson, retry the question, then **Mark understood** to remove it.
- Select an answer, then **Check answer** for the correct choice and an
  explanation. Checked answers are locked before moving to the next question.
- At the end, only wrong answers are saved in a new **Interview mistakes**
  notebook note, including the question, choices, your answer, correct answer,
  explanation, and a review checklist. **Download mistakes .md** saves the same
  Markdown locally. A perfect round creates no mistakes note.
- Finished notes use the existing D1 notebook storage and are available across
  signed-in devices. An unfinished round stays in this browser tab’s session
  storage through navigation and reloads, not across devices or after the tab
  is closed. A visible warning explains if browser storage is unavailable.
- Failed saves keep the results available for retry or download. Retrying an
  ambiguously successful save cannot create a duplicate note or overwrite a
  subsequent manual edit. No new database migration is needed.
- `test/interview.test.mjs` covers question data, grading, authentication, and
  retry-safe persistence. `test/interview.browser.mjs` covers the practice flow,
  round recovery, save failures, downloads, mobile layouts, and navigation using
  intercepted requests rather than real notes.

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

## Books

- Click **Books** at the top of the sidebar. Upload PDF and EPUB files with
  **Upload book** or by dropping them on the page. The limit is 95 MB for each
  file. A file already in the library is refused, and the message names the
  copy that is stored.
- The upload keeps only the title from a file name like
  `Title -- Author -- Publisher -- ISBN -- hash`.
- The files live in an R2 bucket and stream to the reader. D1 holds only the
  title, size, and reading position.
- Each book has an address: `#/books` is the library and `#/books/<id>` is a
  book. Reload, the back button and a saved link all return to the same place.
- **Rename** edits the title in place. **Delete** asks twice: the first click
  arms the button, and the second click removes the file from R2. It cannot be
  undone.
- A **PDF** is drawn by pdf.js in a scroll box. Only the pages near the screen
  are drawn. The reader saves the page and the place on it as you scroll, and
  opens the book there next time. The contents menu comes from the PDF's own
  outline. The words can be selected, and Ctrl+F finds them on the pages that
  are drawn. Type a page number in the **Page** box to jump to it.
- An **EPUB** is drawn by epub.js. Use the contents menu, the arrow keys or the
  ‹ › buttons to move. The reader saves the position and shows the progress.
- **A−** and **A+** change the text size of an EPUB and the zoom of a PDF.
  **Dark** and **Light** switch the EPUB theme, or invert the pages of a PDF.
- **Hide sidebar** removes the sidebar while you read and **Show sidebar**
  brings it back. The choice is remembered. On a narrow screen the sidebar
  starts hidden. Leaving the reader always shows the sidebar again.
- Escape leaves the reader, then the library. On a phone, **‹ Notes** at the top left of the Books and Files pages goes back to the notes.
- pdf.js loads its main build in a recent browser. A browser that lacks the newest JavaScript features gets the legacy build from `public/vendor/legacy/` (pdf.js 6.3.289, 518,555 and 1,317,034 bytes). Add `?legacy` to the address, as in `https://obsidian.ibraim.ie/?legacy`, to use it on any browser.
- The readers load only when a book opens, from `public/vendor/`, as plain
  files: `pdf.min.mjs` and `pdf.worker.min.mjs` (pdf.js 6.3.289, Apache-2.0),
  `epub.min.js` (epub.js 0.3.93, BSD-2-Clause) and `jszip.min.js` (JSZip 3.10.1,
  MIT). All four come from the npm packages `pdfjs-dist`, `epubjs` and `jszip`.
  `public/pdf-view.js` is the PDF reader built on pdf.js.
- Existing databases need `migrations/0005_add_books.sql`. The Worker also needs
  the R2 bucket described under Deploy.

## Files

- Click **Files** in the sidebar. Upload a file of up to 1 MB with **Upload
  file** or by dropping it on the page. Any type is accepted, for example a
  Markdown file.
- Sign in on another PC or device, open **Files**, and click a file to download
  it. **Delete** asks twice and removes the file for good.
- The bytes live in the same R2 bucket as the books, under `files/`. D1 keeps the
  name and the size.
- Every download is sent as an attachment with a neutral type, so a file that is
  HTML or a script is saved and never runs on this site. A name loses any path.
- The address `#/files` opens the page. The limit is `FILE_LIMIT` in `worker.js`.
- Existing databases need `migrations/0006_add_files.sql`.

## Time tracker

- Type a task, press Start. One entry runs at a time.
- Totals for today, this week and this month sit under the clock. Click them
  for the report: a bar per day, and every entry of the month, editable.
  Escape, **Back to notes**, or a click on a note closes the report.
- The page sends a heartbeat every 5 minutes. If the laptop sleeps and the
  heartbeats stop for 15 minutes, the entry ends at the last one.

## Bus lab

`lab/` is a hands-on workspace for writing the live bus map from scratch, stage
by stage, separate from the notebook. It is not deployed and the notebook does
not link it. Run `npm run lab` and open http://127.0.0.1:8788/. See
[lab/README.md](lab/README.md) and [lab/PLAN.md](lab/PLAN.md).

## Run locally

```sh
npm ci
echo "PASSWORD=anything" > .dev.vars
npx wrangler d1 execute ibraim-obsidian-notes --local --file schema.sql
npm run dev
```

The dev command pins the local upstream and host to `127.0.0.1:8787` so OAuth
resource URLs and browser origins agree. If changing the port, change both
host settings as well. Do not substitute the production hostname for a local
OAuth resource URL.

An existing local database needs the files in `migrations/` instead of
`schema.sql`, in order.

## Deploy

Create the R2 bucket once, before the first deploy that includes Books. The
deploy fails without it. The API token also needs the R2 edit permission.

```sh
npx wrangler r2 bucket create ibraim-obsidian-books
```

A push to `main` runs `.github/workflows/deploy.yml`. The workflow applies
the migrations it lists, then deploys the Worker. It needs one repository
secret, `CLOUDFLARE_API_TOKEN`, with the Workers Scripts, D1 edit and R2 edit
permissions. Add a new migration file to the workflow list when you add one.

To deploy by hand instead:

```sh
npx wrangler secret put PASSWORD     # once
npx wrangler d1 execute ibraim-obsidian-notes --remote --file migrations/0005_add_books.sql   # or whichever is new
npx wrangler deploy
```

Sessions are a signed cookie, 12 hours. Failed sign-ins slow down after
the third attempt.
