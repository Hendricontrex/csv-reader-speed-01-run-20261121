// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly csv-reader 1.0.0's answer for every input {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error order, same
// line/row accounting — only the reading is faster.
//
// How it is fast (the reference reads one character at a time and builds
// every field up a character at a time):
//   - Most records are clean: no quote, no stray CR before their line
//     break. Such a record is one slice plus one C++ split(',').
//   - Every other field is read by jumping with indexOf to the next
//     delimiter and slicing, never by appending one character at a time.
//   - Quoted fields jump from quote to quote; doubled quotes and line
//     breaks inside quotes are handled on the slice between two quotes.
//   - No per-field object is allocated: the field readers report through
//     shared locals (fieldValue / fieldEnded / fieldAdded).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call
// to the next. Dependency-free ES module.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1; // drop a leading U+FEFF

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // What the field readers report: the field's value, how it ended
  // (0 comma, 1 line break, 2 end of text) and how many characters were kept.
  let fieldValue = '';
  let fieldEnded = 0;
  let fieldAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr).
  const DELIM = /[,\r\n]/g;
  function readUnquoted(value) {
    let v = value;
    let added = 0;
    let start = pos;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (start < len) { v += text.slice(start, len); added += len - start; }
        pos = len;
        fieldValue = v; fieldEnded = 2; fieldAdded = added;
        return;
      }
      const end = m.index;
      const ch = m[0];
      if (ch === '\r') {
        if (text.charCodeAt(end + 1) === 10) { // CRLF: a line break
          v += text.slice(start, end); added += end - start;
          pos = end + 2; line += 1;
          fieldValue = v; fieldEnded = 1; fieldAdded = added;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        v += text.slice(start, end); added += end - start;
        pos = end + 1;
        start = pos;
        continue;
      }
      v += text.slice(start, end); added += end - start;
      if (ch === ',') {
        pos = end + 1;
        fieldValue = v; fieldEnded = 0; fieldAdded = added;
      } else {
        pos = end + 1; line += 1;
        fieldValue = v; fieldEnded = 1; fieldAdded = added;
      }
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos. One regex scan
  // jumps from special character to special character inside the quotes.
  const QDELIM = /["\r\n]/g;
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let v = '';
    let seg = pos;
    for (;;) {
      QDELIM.lastIndex = pos;
      const m = QDELIM.exec(text);
      if (m === null) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const q = m.index;
      const ch = m[0];
      if (ch === '"') {
        v += text.slice(seg, q);
        if (text.charCodeAt(q + 1) === 34) { // a doubled quote is one quote
          v += '"';
          pos = q + 2;
          seg = pos;
          continue;
        }
        pos = q + 1; // the closing quote
        break;
      }
      // A CRLF or lone CR inside quotes, or an LF, is one LF.
      v += text.slice(seg, q);
      v += '\n';
      line += 1;
      pos = (ch === '\r' && text.charCodeAt(q + 1) === 10) ? q + 2 : q + 1;
      seg = pos;
    }
    if (pos >= len) { fieldValue = v; fieldEnded = 2; fieldAdded = 0; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) { // comma
      pos += 1;
      fieldValue = v; fieldEnded = 0; fieldAdded = 0;
      return;
    }
    if (c === 10) { // LF
      pos += 1; line += 1;
      fieldValue = v; fieldEnded = 1; fieldAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
      pos += 2; line += 1;
      fieldValue = v; fieldEnded = 1; fieldAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(v);
    if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1; line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2; line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    const isHeader = header && columns === null;
    recordRow = isHeader ? null : rows.length;

    // Fast path: a record with no quote and no stray CR before its line
    // break is one slice plus one split.
    const nl = text.indexOf('\n', pos);
    let segEnd;
    let after;
    if (nl === -1) { segEnd = len; after = len; }
    else if (nl > pos && text.charCodeAt(nl - 1) === 13) { segEnd = nl - 1; after = nl + 1; }
    else { segEnd = nl; after = nl + 1; }
    const seg = text.slice(pos, segEnd);
    let fields;
    let quoted = false;
    if (!/["\r]/.test(seg)) {
      fields = seg.split(',');
      pos = after;
      if (nl !== -1) line += 1;
    } else {
      fields = [];
      for (;;) {
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          readQuoted();
        } else {
          quoted = false;
          readUnquoted('');
        }
        fields.push(fieldValue);
        if (fieldEnded !== 0) break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (isHeader) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
