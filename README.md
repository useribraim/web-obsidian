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
- Escape leaves the reader, then the library.
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

## Run locally

```sh
echo "PASSWORD=anything" > .dev.vars
npx wrangler d1 execute ibraim-obsidian-notes --local --file schema.sql
npx wrangler dev
```

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
