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
    if (!match) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    let year = null;
    if (match[3]) year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const readings = [];
    if (first >= 1 && first <= 12) readings.push({ month: first - 1, day: second, penalty: 0 });
    if (second >= 1 && second <= 12 && second !== first) readings.push({ month: second - 1, day: first, penalty: DAY_FIRST_PENALTY });
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

  // The current week is the week of the last dated heading. It does not depend
  // on the clock, so the note looks the same on any day.
  function currentWeek(dates) {
    for (let index = dates.length - 1; index >= 0; index -= 1) if (dates[index]) return mondayOf(dates[index]).getTime();
    return null;
  }

  const monthKey = week => { const date = new Date(week); return date.getFullYear() + '-' + date.getMonth(); };

  root.NoteWeeks = { mondayOf, parseDay, assignDates, currentWeek, monthKey };
})(typeof window !== 'undefined' ? window : module.exports);
