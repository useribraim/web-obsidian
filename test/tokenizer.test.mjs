import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { tokenizeLine, tokenizeDocument, tokenizeInline, retokenize, revealedMarks } =
  createRequire(import.meta.url)('../public/tokenizer.js').NoteTokenizer;

const cases = [];
const test = (name, run) => cases.push([name, run]);
const slice = (line, range) => line.slice(range[0], range[1]);

test('heading marks and inline content', () => {
  const line = '## Plan **now** ##';
  const token = tokenizeLine(line);
  assert.equal(token.type, 'heading');
  assert.equal(token.level, 2);
  assert.deepEqual(token.marks.map(m => slice(line, m)), ['## ', ' ##']);
  assert.equal(token.spans[0].type, 'strong');
  assert.equal(slice(line, token.spans[0].marks[0]), '**');
});

test('task boxes', () => {
  const open = tokenizeLine('- [ ] write tests');
  assert.equal(open.type, 'task');
  assert.equal(open.done, false);
  assert.deepEqual(open.checkbox, [2, 5]);
  assert.deepEqual(open.marks, [[0, 6]]);
  assert.equal(tokenizeLine('  * [x] done').done, true);
  assert.equal(tokenizeLine('- [ ]').type, 'task');
  assert.equal(tokenizeLine('- [link](x)').type, 'list');
});

test('lists keep indent and order', () => {
  const token = tokenizeLine('\t2. second');
  assert.equal(token.type, 'list');
  assert.equal(token.ordered, true);
  assert.equal(token.indent, 2);
});

test('quote, rule, image, blank, paragraph', () => {
  assert.equal(tokenizeLine('> said').type, 'quote');
  assert.equal(tokenizeLine('---').type, 'rule');
  assert.equal(tokenizeLine('- - -').type, 'rule');
  assert.equal(tokenizeLine('![cap](/i/1)').type, 'image');
  assert.equal(tokenizeLine('   ').type, 'blank');
  assert.equal(tokenizeLine('plain').type, 'paragraph');
});

test('fenced code carries state', () => {
  const tokens = tokenizeDocument(['```js', '# not a heading', '**no**', '```', '# heading']);
  assert.deepEqual(tokens.map(t => t.type), ['fence', 'code', 'code', 'fence', 'heading']);
  assert.deepEqual(tokens[1].spans, []);
});

test('inline spans', () => {
  const text = 'a `x*y*` **b *c*** ~~d~~ [e](https://h) f_g_h';
  const spans = tokenizeInline(text);
  const kinds = spans.map(s => s.type + ':' + text.slice(s.start, s.end));
  assert.ok(kinds.includes('code:`x*y*`'));
  assert.ok(kinds.includes('strong:**b *c***'));
  assert.ok(kinds.includes('em:*c*'));
  assert.ok(kinds.includes('del:~~d~~'));
  assert.ok(kinds.includes('link:[e](https://h)'));
  assert.equal(spans.filter(s => s.type === 'em').length, 1, 'snake_case is not emphasis');
});

test('an inline image is one mark that shows when the caret touches it', () => {
  const line = 'a ![x](/i/1) b';
  const token = tokenizeLine(line);
  const image = token.spans.find(span => span.type === 'image');
  assert.deepEqual(image.marks, [[2, 12]]);
  assert.deepEqual(revealedMarks(token, 0), []);
  assert.deepEqual(revealedMarks(token, 5).map(m => slice(line, m)), ['![x](/i/1)']);
});

test('spans nest and never partly overlap', () => {
  const spans = tokenizeInline('**a *b* c** and *d*');
  for (const a of spans) for (const b of spans) {
    if (a === b) continue;
    const disjoint = a.end <= b.start || b.end <= a.start;
    const nested = (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
    assert.ok(disjoint || nested);
  }
});

test('marks are hidden until the caret arrives', () => {
  const line = 'x **bold** y';
  const token = tokenizeLine(line);
  assert.deepEqual(revealedMarks(token, null), []);
  assert.deepEqual(revealedMarks(token, 0), []);
  assert.deepEqual(revealedMarks(token, 5).map(m => slice(line, m)), ['**', '**']);
});

test('retokenize rescans one line, or follows a fence change', () => {
  const lines = ['a', 'b', 'c'];
  const tokens = tokenizeDocument(lines);
  const keep = tokens[2];
  lines[1] = '# b';
  tokens[1] = undefined;
  assert.equal(retokenize(lines, tokens, 1), 2);
  assert.equal(tokens[1].type, 'heading');
  assert.equal(tokens[2], keep);

  lines[0] = '```';
  tokens[0] = undefined;
  assert.equal(retokenize(lines, tokens, 0), 3);
  assert.deepEqual(tokens.map(t => t.type), ['fence', 'code', 'code']);
});

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('ok   ' + name); }
  catch (error) { failed += 1; console.log('FAIL ' + name + '\n' + error.message); }
}
process.exit(failed ? 1 : 0);
