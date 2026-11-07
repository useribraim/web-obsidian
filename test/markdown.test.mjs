import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the actual preview renderer without booting the app or its API.
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const renderer = app.slice(app.indexOf('function escapeHtml('), app.indexOf('function renderPreview('));
const render = runInNewContext(renderer + '\nrenderMarkdown;', { content: { disabled: false } });

test('renders the four-column schedule as a semantic table', () => {
  const html = render('## Days\n\n| Day | Patterns | New problems | Non-coding task |\n| --- | --- | --- | --- |\n| Thu 22 Oct | Hash map | #560 | Write `openvino_defence.md` |\n| Fri 23 Oct | BFS/DFS | #200 | Method defect story |\n\n## Notes');
  assert.equal((html.match(/<th scope="col"/g) || []).length, 4);
  assert.equal((html.match(/<td /g) || []).length, 8);
  assert.match(html, /<code>openvino_defence.md<\/code>/);
  assert.match(html, /<\/table><\/div><h2>Notes<\/h2>/);
  assert.doesNotMatch(html, /<p>\|/);
});

test('supports alignment, optional outer pipes, escaped pipes and inline formatting', () => {
  const html = render('Name | Value | Status\n:--- | :---: | ---:\n**A** \\| B | `x` | [ok](https://example.com)');
  assert.match(html, /class="table-left"><strong>A<\/strong> \| B<\/td>/);
  assert.match(html, /class="table-center"><code>x<\/code><\/td>/);
  assert.match(html, /class="table-right"><a href="https:\/\/example.com"/);
});

test('normalizes short and long rows to the header width', () => {
  const html = render('| A | B |\n| --- | --- |\n| one |\n| two | three | ignored |');
  assert.equal((html.match(/<td /g) || []).length, 4);
  assert.match(html, /<td class="table-left"><\/td>/);
  assert.doesNotMatch(html, /ignored/);
});

test('recognizes tables directly after paragraphs and inside quotes', () => {
  assert.match(render('Intro\nA | B\n--- | ---\n1 | 2'), /<p>Intro<\/p><div class="table-scroll"/);
  assert.match(render('> A | B\n> --- | ---\n> 1 | 2'), /<blockquote><div class="table-scroll"/);
});

test('leaves ordinary pipes, invalid dividers and fenced code alone', () => {
  for (const source of ['a | b', 'a | b\n--- | nope', 'a | b\n--- | --- | ---', '```\n| a | b |\n| --- | --- |\n```']) {
    assert.doesNotMatch(render(source), /<table>/);
  }
});

test('escapes HTML and unsafe links in table cells', () => {
  const html = render('| A | B |\n| --- | --- |\n| <script>alert(1)</script> | [click](javascript:alert) |');
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="#"/);
});
