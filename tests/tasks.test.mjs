import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
// Exercise the real renderer and preview-change handler without a browser or
// production services. The app uses plain scripts rather than exported modules.
const renderer = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function renderPreview('));
const offsets = source.slice(source.indexOf('function taskLineOffsets('), source.indexOf('// A click on a preview check box'));
const changes = source.slice(source.indexOf("preview.addEventListener('change'", source.indexOf('// A click on a preview check box')), source.indexOf('// ⌘L:'));
function harness(markdown = '', folded = '') {
  let change;
  let inputEvents = 0;
  const content = {
    value: markdown, disabled: false,
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); },
    dispatchEvent() { inputEvents += 1; },
  };
  const context = vm.createContext({
    content, foldedSource: folded, mode: 'active', Event,
    preview: { addEventListener(type, handler) { assert.equal(type, 'change'); change = handler; } },
    renderPreview() {},
  });
  context.noteText = () => context.foldedSource + content.value;
  vm.runInContext(renderer + '\n' + offsets + '\n' + changes, context);
  return {
    context, content,
    render(markdown) {
      context.markdown = markdown;
      return vm.runInContext('taskCount = 0; renderMarkdown(markdown)', context);
    },
    click(index) { change({ target: { dataset: { task: String(index) }, matches: () => true } }); },
    text: () => context.noteText(),
    inputEvents: () => inputEvents,
  };
}
const screenshot = '- [ ] microsoft prep 27 questions\n\n16.00 - 19.00\n10 leetcodes, microsoft hackerrank prep\n- [ ] > 692 , 560 , 1493 , 198\n- [ ] > 424 , 1615 , 200\n- [ ] > 994 , 547 , 397 ,\n\n  10 job applications\n\n20.00 - 23.00\n\n6h of study today';

test('the screenshot format has one primary and three secondary tasks across paragraphs', () => {
  const html = harness().render(screenshot);
  assert.equal((html.match(/class="task task-primary"/g) || []).length, 1);
  assert.equal((html.match(/class="task task-secondary"/g) || []).length, 3);
  assert.deepEqual([...html.matchAll(/data-task="(\d+)"/g)].map(match => Number(match[1])), [0, 1, 2, 3]);
  assert(!html.includes('&gt;'));
  assert(html.includes('16.00 - 19.00'));
  assert(html.includes('10 job applications'));
});

test('tabs and spaces nest secondary tasks, then return to primary tasks', () => {
  const html = harness().render('- [ ] Parent\n\t- [ ] Child\n    - [x] Grandchild\n- [ ] Next parent');
  assert.equal((html.match(/task-primary/g) || []).length, 2);
  assert.equal((html.match(/task-secondary/g) || []).length, 2);
  assert.match(html, /Parent<\/span><\/label><ul><li class="task task-secondary"/);
  assert.match(html, /task-secondary done"><label class="task-label"><input[^>]+checked/);
  assert.equal((html.match(/<ul>/g) || []).length, (html.match(/<\/ul>/g) || []).length);
});

test('an indented task after a paragraph is still secondary', () => {
  const html = harness().render('- [ ] Parent\n\nContext\n\n  - [ ] Child');
  assert.match(html, /class="task task-secondary"/);
});

test('ordinary lists, quoted tasks, code fences and comparisons retain their meaning', () => {
  const html = harness().render('- Ordinary list\n  - [ ] Nested task\n\n> - [ ] Quoted task\n\n- [ ] >5 items\n\n```\n- [ ] > Not a task\n```');
  assert.match(html, /<li>Ordinary list<ul><li class="task task-secondary"/);
  assert.match(html, /<blockquote><ul><li class="task task-primary"/);
  assert.match(html, /task-primary[^]*&gt;5 items/);
  assert.match(html, /<pre><code>- \[ \] &gt; Not a task<\/code><\/pre>/);
  assert.deepEqual([...html.matchAll(/data-task="(\d+)"/g)].map(match => Number(match[1])), [0, 1, 2]);
});

test('task labels escape markup and empty tasks retain an accessible name', () => {
  const html = harness().render('- [ ] > <script>alert(1)</script>\n- [ ] >\n- [ ]');
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('aria-label="Subtask"'));
  assert(html.includes('aria-label="Task"'));
});

test('checking a secondary task changes only that line, retaining source shorthand', () => {
  const app = harness(screenshot);
  app.click(2);
  assert.equal(app.text(), screenshot.replace('- [ ] > 424', '- [x] > 424'));
  assert.equal(app.inputEvents(), 1);
  app.click(2);
  assert.equal(app.text(), screenshot);
});

test('checking a parent leaves its nested children unchanged', () => {
  const text = '- [ ] Parent\n  - [ ] Child\n  - [x] Finished child';
  const app = harness(text);
  app.click(0);
  assert.equal(app.text(), '- [x] Parent\n  - [ ] Child\n  - [x] Finished child');
  const html = app.render(app.text());
  assert.match(html, /task-primary done/);
  assert.match(html, /class="task task-secondary"><label/);
});

test('task indexes skip code fences and reach tasks inside blockquotes', () => {
  const text = '```\n- [ ] Not a task\n```\n> - [ ] Quoted parent\n\n- [ ] > Secondary';
  const app = harness(text);
  app.click(1);
  assert.equal(app.text(), text.replace('- [ ] > Secondary', '- [x] > Secondary'));
  app.click(0);
  assert.equal(app.text(), text.replace('> - [ ] Quoted parent', '> - [x] Quoted parent').replace('- [ ] > Secondary', '- [x] > Secondary'));
});

test('checking a folded secondary task preserves the visible editor content', () => {
  const folded = '- [ ] Parent\n- [ ] > Earlier child\n\n';
  const visible = '- [ ] Current task';
  const app = harness(visible, folded);
  app.click(1);
  assert.equal(app.context.foldedSource, folded.replace('- [ ] > Earlier child', '- [x] > Earlier child'));
  assert.equal(app.content.value, visible);
});

test('read-only previews cannot modify tasks', () => {
  const app = harness(screenshot);
  app.content.disabled = true;
  app.click(1);
  assert.equal(app.text(), screenshot);
  assert.equal(app.inputEvents(), 0);
});
