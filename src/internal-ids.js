// A job's Internal IDs come from a Workflow subject export: a CSV with an "Internal ID" column.
// Every kiosk draws from the same series, so the IDs are split into the job's parts and each
// kiosk uses its own part.

const ID_COLUMN = 'internal id';
// Digits only. This also catches IDs a spreadsheet has mangled, like "1.23457E+11".
const ID_PATTERN = /^\d+$/;
const MAX_LISTED = 5; // problem rows listed in one error message

// Returns the CSV's rows as arrays of fields. Handles quoted fields (with "" for a quote),
// commas and line breaks inside quotes, CRLF/LF/CR line endings, and a byte order mark.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text).replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function problemList(problems) {
  const listed = problems.slice(0, MAX_LISTED).join(' ');
  const more = problems.length - MAX_LISTED;
  return more > 0 ? `${listed} …and ${more} more.` : listed;
}

// Returns { error } or { ids } in file order, read from the "Internal ID" column. Blank lines
// are skipped; any other row needs a valid ID that no other row has.
export function readInternalIdCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: 'The CSV file is empty.' };

  const header = rows[0].map((h) => h.trim());
  const column = header.findIndex((h) => h.toLowerCase() === ID_COLUMN);
  if (column === -1) {
    const found = header.filter(Boolean).map((h) => `"${h}"`).join(', ') || 'none';
    return { error: `The CSV has no "Internal ID" column. Columns found: ${found}.` };
  }

  const ids = [];
  const seen = new Map(); // id -> row number
  const problems = [];
  rows.slice(1).forEach((fields, i) => {
    const rowNumber = i + 2; // as a spreadsheet numbers it, with the header as row 1
    if (fields.every((f) => f.trim() === '')) return;
    const id = (fields[column] ?? '').trim();
    if (!id) {
      problems.push(`Row ${rowNumber} has no Internal ID.`);
    } else if (!ID_PATTERN.test(id)) {
      problems.push(`Row ${rowNumber}: "${id}" isn't a valid Internal ID.`);
    } else if (seen.has(id)) {
      problems.push(`Row ${rowNumber}: ${id} is already on row ${seen.get(id)}.`);
    } else {
      seen.set(id, rowNumber);
      ids.push(id);
    }
  });

  if (problems.length > 0) return { error: problemList(problems) };
  if (ids.length === 0) return { error: 'The CSV has no Internal IDs.' };
  return { ids };
}

// Returns { error } or { ids }, for a list of IDs sent back from the job form.
export function validateInternalIds(input) {
  if (!Array.isArray(input)) return { error: 'Internal IDs are invalid.' };
  const ids = input.map((id) => String(id ?? '').trim());
  const bad = ids.find((id) => !ID_PATTERN.test(id));
  if (bad !== undefined) return { error: `"${bad}" isn't a valid Internal ID.` };
  if (new Set(ids).size !== ids.length) return { error: 'Internal IDs must not repeat.' };
  return { ids };
}

// Splits the IDs, in order, into `parts` runs whose sizes differ by at most one. The earlier
// parts get the extras. Returns the part number (1-based) for each ID.
export function partNumbers(count, parts) {
  const size = Math.floor(count / parts);
  const extra = count % parts;
  const numbers = [];
  for (let part = 1; part <= parts; part++) {
    const n = size + (part <= extra ? 1 : 0);
    for (let i = 0; i < n; i++) numbers.push(part);
  }
  return numbers;
}
