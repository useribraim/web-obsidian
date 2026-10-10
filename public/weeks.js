// Dates in day headings, and the weeks and months they fall in. Pure functions,
// so a Node script can test them without a browser.
//
// A heading starts with a date: "9/28", "28/9", "01/10", "9.28", "9/28/2026" or
// "2026-10-01". The note is written from top to bottom, so each heading is read
// against the one before it. That settles the cases a date alone cannot:
// "01/10" after "9/30" is the 1st of October, not the 10th of January.
(function (root) {
  const DAY = 86400000;
  // Month first is the habit of the notes this was made for. Day first wins only
  // when it fits the earlier heading by more than this many days better.
  const DAY_FIRST_PENALTY = 20;
  // A note is written forward in time, so a date before the previous heading is
  // less likely than one after it. The first heading has no such rule: it is
  // measured against today, and an old note starts in the past.
  const BACKWARD_PENALTY = 30;
  // "3 oct 2026", "Oct 3", "10 October", "Mon 5th Oct". The whole word must be a month,
  // so "5 minutes" is not a date.
  const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  const WEEKDAY = '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+)?';
  const DAY_MONTH = new RegExp('^' + WEEKDAY + '(\\d{1,2})(?:st|nd|rd|th)?\\s+([a-z]{3,9})\\.?(?:,?\\s+(\\d{4}))?(?![\\w])', 'i');
  const MONTH_DAY = new RegExp('^' + WEEKDAY + '([a-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\w])', 'i');
  const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
  const SLASH_DAY = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?!\d)/;

  function validDate(year, month, day) {
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }

  function mondayOf(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }

  // The date a heading names, or null if it names none. `anchor` is the date of
  // the heading before it, or today for the first one.
  function parseDay(text, anchor, fromHeading = false) {
    const trimmed = text.trim();
    const iso = ISO_DAY.exec(trimmed);
    if (iso) return validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const match = SLASH_DAY.exec(trimmed);
    if (!match) return parseNamedDay(trimmed, anchor, fromHeading);
    const first = Number(match[1]);
    const second = Number(match[2]);
    let year = null;
    if (match[3]) year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const readings = [];
    if (first >= 1 && first <= 12) readings.push({ month: first - 1, day: second, penalty: 0 });
    if (second >= 1 && second <= 12 && second !== first) readings.push({ month: second - 1, day: first, penalty: DAY_FIRST_PENALTY });
    return bestReading(readings, year, anchor, fromHeading);
  }

  // The reading, and the year, that sit closest to the anchor.
  function bestReading(readings, year, anchor, fromHeading) {
    let best = null;
    for (const reading of readings) {
      const years = year ? [year] : [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1];
      for (const candidate of years) {
        const date = validDate(candidate, reading.month, reading.day);
        if (!date) continue;
        const score = Math.abs(date - anchor) / DAY + reading.penalty + (fromHeading && date < anchor ? BACKWARD_PENALTY : 0);
        if (!best || score < best.score) best = { date, score };
      }
    }
    return best ? best.date : null;
  }

  // A month written as a word: "3 oct 2026" or "Oct 3".
  function parseNamedDay(trimmed, anchor, fromHeading) {
    let day, name, year;
    let match = DAY_MONTH.exec(trimmed);
    if (match) [, day, name, year] = match;
    else if ((match = MONTH_DAY.exec(trimmed))) [, name, day, year] = match;
    else return null;
    const month = MONTHS[name.toLowerCase()];
    if (month === undefined) return null;
    return bestReading([{ month, day: Number(day), penalty: 0 }], year ? Number(year) : null, anchor, fromHeading);
  }

  // One date, or null, for each heading text, in order.
  function assignDates(texts, today = new Date()) {
    let anchor = today;
    let fromHeading = false;
    return texts.map(text => {
      const date = parseDay(text, anchor, fromHeading);
      if (date) { anchor = date; fromHeading = true; }
      return date;
    });
  }

  // The last day heading of a note ends the window. It does not depend on the
  // clock, so the note looks the same on any day.
  function lastDay(dates) {
    for (let index = dates.length - 1; index >= 0; index -= 1) if (dates[index]) return dates[index];
    return null;
  }

  // Compact mode keeps this many days open, counting the last day heading.
  const DAYS_SHOWN = 5;
  // Midnight of the oldest day that stays open.
  function shownFromDay(last, count = DAYS_SHOWN) {
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() - (count - 1)).getTime();
  }

  const monthKey = week => { const date = new Date(week); return date.getFullYear() + '-' + date.getMonth(); };

  root.NoteWeeks = { mondayOf, parseDay, assignDates, lastDay, shownFromDay, monthKey };
})(typeof window !== 'undefined' ? window : module.exports);
