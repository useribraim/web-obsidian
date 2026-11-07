// Line tokenizer for the live editor. Pure functions, so a Node script can test
// them without a browser.
//
// A note is a list of source lines. Each line becomes one token that says what
// the line is (heading, task, quote...) and where its Markdown marks sit. The
// editor draws the line from the token. It hides the marks, and shows the marks
// of the line or the span that holds the caret. The text itself is never
// changed here: every range is an offset into the original line.
//
// Only fenced code carries state from one line to the next, so an edit to one
// line needs a rescan of that line and, rarely, of the lines below it.
(function (root) {
  const FENCE_OPEN = /^```\w*\s*$/;
  const FENCE_CLOSE = /^```\s*$/;
  const HEADING = /^(#{1,6})(\s+)(.*?)(\s*#*\s*)$/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^(\s*>\s?)(.*)$/;
  const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
  const CHECKBOX = /^\[([ xX])\](?=\s|$)/;
  const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
  const MASK = '\u0000';

  const START = Object.freeze({ fence: false });

  // Replace a range with the mask character, so a later pass cannot match it.
  function mask(text, start, end) {
    return text.slice(0, start) + MASK.repeat(end - start) + text.slice(end);
  }

  // Inline spans of one run of text. `base` is the offset of the run in the
  // line. Each span is { type, start, end, marks }, where `marks` are the
  // ranges the editor hides until the caret enters the span. Spans may nest;
  // they never partly overlap.
  function tokenizeInline(text, base = 0) {
    const spans = [];
    let work = text;
    const find = (pattern, handle) => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(work))) handle(match);
    };

    // Code first: nothing inside backticks is Markdown.
    find(/`([^`]+)`/g, match => {
      const start = match.index;
      const end = start + match[0].length;
      spans.push({ type: 'code', start: base + start, end: base + end, marks: [[base + start, base + start + 1], [base + end - 1, base + end]] });
    });
    for (const span of spans) work = mask(work, span.start - base, span.end - base);

    find(/!\[([^\]]*)\]\(([^)\s]+)\)/g, match => {
      const start = match.index;
      const end = start + match[0].length;
      // The whole syntax is the mark: the picture replaces it until the caret arrives.
      spans.push({ type: 'image', start: base + start, end: base + end, alt: match[1], href: match[2], marks: [[base + start, base + end]] });
    });
    for (const span of spans) if (span.type === 'image') work = mask(work, span.start - base, span.end - base);

    // A link hides "[" and "](url)"; the label stays and may hold emphasis.
    find(/\[([^\]]+)\]\(([^)\s]+)\)/g, match => {
      const start = match.index;
      const end = start + match[0].length;
      const labelEnd = start + 1 + match[1].length;
      spans.push({ type: 'link', start: base + start, end: base + end, href: match[2], marks: [[base + start, base + start + 1], [base + labelEnd, base + end]] });
      work = mask(work, start, start + 1);
      work = mask(work, labelEnd, end);
    });

    // Emphasis, longest marker first. A matched marker is masked so a shorter
    // pattern cannot reuse it. An underscore inside a word is not emphasis, so
    // snake_case_name stays as written.
    const emphasis = [
      ['strong-em', /\*\*\*([^*]+)\*\*\*/g, 3],
      ['strong-em', /(?<![\w])___([^_]+)___(?![\w])/g, 3],
      ['strong', /\*\*(?!\*)(.+?)\*\*(?!\*)/g, 2],
      ['strong', /(?<![\w])__(?!_)(.+?)__(?![\w])/g, 2],
      ['em', /\*([^*]+)\*/g, 1],
      ['em', /(?<![\w])_([^_]+)_(?![\w])/g, 1],
      ['del', /~~([^~]+)~~/g, 2]
    ];
    for (const [type, pattern, width] of emphasis) {
      const matches = [];
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(work))) matches.push({ start: match.index, end: match.index + match[0].length });
      for (const { start, end } of matches) {
        spans.push({ type, start: base + start, end: base + end, marks: [[base + start, base + start + width], [base + end - width, base + end]] });
        work = mask(work, start, start + width);
        work = mask(work, end - width, end);
      }
    }
    return spans.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  // One line. `state` is the result for the line above, or START.
  // Returns { type, state, marks, spans, ... }. `type` is one of: blank, fence,
  // code, image, heading, rule, quote, task, list, paragraph. `marks` are the
  // block marks: the ranges the editor hides until the caret is on the line.
  function tokenizeLine(line, state = START) {
    if (state.fence) {
      if (FENCE_CLOSE.test(line.trim())) return { type: 'fence', state: START, marks: [[0, line.length]], spans: [] };
      return { type: 'code', state, marks: [], spans: [] };
    }
    if (FENCE_OPEN.test(line.trim())) {
      return { type: 'fence', state: { fence: true }, marks: [[0, line.length]], spans: [], language: line.trim().slice(3) };
    }
    const next = START;
    if (line.trim() === '') return { type: 'blank', state: next, marks: [], spans: [] };

    const image = IMAGE_LINE.exec(line);
    if (image) return { type: 'image', state: next, marks: [], spans: [], alt: image[1], href: image[2] };

    const heading = HEADING.exec(line);
    if (heading) {
      const start = heading[1].length + heading[2].length;
      const end = start + heading[3].length;
      const marks = [[0, start]];
      if (end < line.length) marks.push([end, line.length]);
      return { type: 'heading', level: heading[1].length, state: next, marks, spans: tokenizeInline(heading[3], start) };
    }
    if (RULE.test(line)) return { type: 'rule', state: next, marks: [[0, line.length]], spans: [] };

    const quote = QUOTE.exec(line);
    if (quote) {
      return { type: 'quote', state: next, marks: [[0, quote[1].length]], spans: tokenizeInline(quote[2], quote[1].length) };
    }

    const list = LIST.exec(line);
    if (list) {
      const indent = list[1].replace(/\t/g, '  ').length;
      const ordered = /^\d/.test(list[2]);
      const start = list[1].length + list[2].length + list[3].length;
      const box = CHECKBOX.exec(list[4]);
      if (box) {
        const boxStart = start;
        const boxEnd = start + 3;
        const contentStart = Math.min(line.length, boxEnd + (/\s/.test(line[boxEnd] || '') ? 1 : 0));
        return {
          type: 'task', indent, ordered, done: box[1] !== ' ', state: next,
          checkbox: [boxStart, boxEnd],
          marks: [[0, contentStart]],
          spans: tokenizeInline(line.slice(contentStart), contentStart)
        };
      }
      return { type: 'list', indent, ordered, state: next, marks: [[list[1].length, start]], spans: tokenizeInline(list[4], start) };
    }
    return { type: 'paragraph', state: next, marks: [], spans: tokenizeInline(line, 0) };
  }

  // Every line of a note.
  function tokenizeDocument(lines) {
    const tokens = [];
    let state = START;
    for (const line of lines) {
      const token = tokenizeLine(line, state);
      token.before = state.fence;
      tokens.push(token);
      state = token.state;
    }
    return tokens;
  }

  // After an edit, rescan from line `from`. A token that is undefined is dirty:
  // the caller puts undefined where a line was inserted or changed. The scan
  // goes on past `from` only while the fence state differs from the old one, so
  // a normal edit rescans one line. Returns the index after the last line
  // rescanned, so the caller knows which lines to draw again.
  function retokenize(lines, tokens, from) {
    tokens.length = lines.length;
    let state = from > 0 ? tokens[from - 1].state : START;
    let index = from;
    for (; index < lines.length; index += 1) {
      const old = tokens[index];
      if (index > from && old && old.before === state.fence) break;
      const token = tokenizeLine(lines[index], state);
      token.before = state.fence;
      tokens[index] = token;
      state = token.state;
    }
    return index;
  }

  // The ranges the editor shows as raw Markdown. `caret` is an offset in the
  // line, or null when the caret is on another line. A span shows its marks
  // when the caret is inside it or touches it. The block marks show whenever
  // the caret is on the line.
  function revealedMarks(token, caret) {
    if (caret === null || caret === undefined) return [];
    const shown = token.marks.slice();
    for (const span of token.spans) {
      if (caret >= span.start && caret <= span.end) shown.push(...span.marks);
    }
    return shown.sort((a, b) => a[0] - b[0]);
  }

  root.NoteTokenizer = { START, tokenizeInline, tokenizeLine, tokenizeDocument, retokenize, revealedMarks };
})(typeof window !== 'undefined' ? window : module.exports);
