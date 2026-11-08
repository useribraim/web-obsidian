import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/live-view.js', import.meta.url), 'utf8');
function history() {
  const methods = source.slice(source.indexOf('    function remember('), source.indexOf('    function deletionRange('));
  return runInNewContext(`
    let text = '', selection = [0, 0], lastKind = '', lastTime = 0, lastCaret = -1;
    const undoStack = [], redoStack = [], HISTORY_LIMIT = 200, TYPING_PAUSE = 1000;
    const performance = { now: () => 1 };
    const readSelection = () => selection;
    const writeSelection = (a, b) => { selection = [a, b]; };
    const applyEdit = (a, b, insert) => { text = text.slice(0, a) + insert + text.slice(b); };
    const syncReveal = () => {};
    const InputEvent = class {};
    const host = { dispatchEvent() {} };
    ${methods}
    ({ commit, remember, undo: () => travel(undoStack, redoStack), redo: () => travel(redoStack, undoStack),
      get text() { return text; }, select: writeSelection })
  `);
}

test('continuous typing undoes and redoes as a group', () => {
  const editor = history();
  editor.commit(0, 0, 'a', 'insertText');
  editor.commit(1, 1, 'b', 'insertText');
  editor.undo();
  assert.equal(editor.text, '');
  editor.redo();
  assert.equal(editor.text, 'ab');
});

test('moving the caret starts a separate undo group even during fast typing', () => {
  const editor = history();
  editor.commit(0, 0, 'ab', 'insertText');
  editor.select(0, 0);
  editor.commit(0, 0, 'x', 'insertText');
  editor.undo();
  assert.equal(editor.text, 'ab');
  editor.undo();
  assert.equal(editor.text, '');
});

test('replacing selected text is separate from the preceding typing group', () => {
  const editor = history();
  editor.commit(0, 0, 'ab', 'insertText');
  editor.select(0, 2);
  editor.commit(0, 2, 'x', 'insertText');
  editor.undo();
  assert.equal(editor.text, 'ab');
});

test('composed text undoes to the buffer before composition began', () => {
  const methods = source.slice(source.indexOf('    function remember('), source.indexOf('    function deletionRange('));
  const composition = source.slice(source.indexOf('    function adoptDom('), source.indexOf('    // ---- Pointer and selection'));
  const editor = runInNewContext(`
    let text = 'before', lines = ['before'], composing = false, disabled = false;
    let lastKind = '', lastTime = 0, lastCaret = -1;
    const undoStack = [], redoStack = [], HISTORY_LIMIT = 200, TYPING_PAUSE = 1000;
    const performance = { now: () => 1 }, handlers = {};
    const readSelection = () => [6, 6], writeSelection = () => {};
    const applyEdit = (a, b, insert) => { text = text.slice(0, a) + insert + text.slice(b); };
    const syncReveal = () => {}, rebuildStarts = () => {}, drawAll = () => {};
    const InputEvent = class {};
    const host = { children: [], dispatchEvent() {}, addEventListener(name, fn) { handlers[name] = fn; } };
    ${methods}
    ${composition}
    ({ compose(value) {
      handlers.compositionstart();
      host.children = [{ classList: { contains: () => true }, textContent: value }];
      handlers.compositionend();
    }, undo: () => travel(undoStack, redoStack), redo: () => travel(redoStack, undoStack),
      get text() { return text; } })
  `);
  editor.compose('before漢');
  assert.equal(editor.text, 'before漢');
  editor.undo();
  assert.equal(editor.text, 'before');
  editor.redo();
  assert.equal(editor.text, 'before漢');
});
