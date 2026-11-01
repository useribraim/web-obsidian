import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { NoteWeeks } = createRequire(import.meta.url)('../public/weeks.js');
const day = date => date && date.toDateString();
const today = new Date(2026, 9, 31);

test('the first heading is not read as a future date', () => {
  const dates = NoteWeeks.assignDates(['9/11', '9/15'], today);
  assert.equal(day(dates[0]), new Date(2026, 8, 11).toDateString());
});

test('a first heading may still name tomorrow', () => {
  const dates = NoteWeeks.assignDates(['11/1'], today);
  assert.equal(day(dates[0]), new Date(2026, 10, 1).toDateString());
});

test('Russian month names are read in Cyrillic and in Latin letters', () => {
  const dates = NoteWeeks.assignDates(['27 oct', '29 oktabrya', '30 oktyabrya', '31 октября', '1 Ноября'], today);
  assert.deepEqual(dates.map(day), [
    new Date(2026, 9, 27), new Date(2026, 9, 29), new Date(2026, 9, 30), new Date(2026, 9, 31), new Date(2026, 10, 1),
  ].map(day));
});

test('a word that is not a month is not a date', () => {
  assert.equal(NoteWeeks.parseDay('5 minutes', today), null);
  assert.equal(NoteWeeks.parseDay('5 октябрьский', today), null);
});

test('compact mode keeps only the last day open', () => {
  const last = new Date(2026, 9, 31);
  assert.equal(NoteWeeks.shownFromDay(last), last.getTime());
});

test('a month name with a small typo is still a month', () => {
  const dates = NoteWeeks.assignDates(['31 oktabrya', '1 novmber', '2 noyabria'], today);
  assert.deepEqual(dates.map(day), [new Date(2026, 9, 31), new Date(2026, 10, 1), new Date(2026, 10, 2)].map(day));
});

test('a word close to a short month name is not a month', () => {
  for (const heading of ['3 mayor', '2 market', '1 decision', '4 junior', '5 octopus']) {
    assert.equal(NoteWeeks.parseDay(heading, today), null, heading);
  }
});
