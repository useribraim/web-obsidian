import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function pinnedReminder(');
const end = source.indexOf('function renderPreview()', start);
const reminder = runInNewContext(source.slice(start, end) + '\npinnedReminder');

test('pins an explicit reminder and preserves multiline content', () => {
  assert.equal(reminder('> [!pin] Daily minimum: 1 application, 1 LeetCode'), 'Daily minimum: 1 application, 1 LeetCode');
  assert.equal(reminder('> [!PIN]\r\n> Daily minimum\r\n> 1 job application\r\n> 1 LeetCode\n\nOther text'), 'Daily minimum\n1 job application\n1 LeetCode');
});
test('normal quotes and fenced examples do not pin', () => {
  assert.equal(reminder('> Normal quote'), '');
  assert.equal(reminder('```md\n> [!pin] Example\n```'), '');
  assert.equal(reminder('~~~md\n> [!pin] Example\n~~~\n> [!pin] Real reminder'), 'Real reminder');
});
test('first pin wins, and removing it clears the reminder', () => {
  assert.equal(reminder('> [!pin] First\n\n> [!pin] Second'), 'First');
  assert.equal(reminder(''), '');
});
