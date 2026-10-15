// A job's entries as a CSV, for the "Download job data" button on the Edit Job screen.
import { rateLabelFor } from './entry-options.js';

// A field Excel would read as a formula gets a leading apostrophe, so a name like "=1+1"
// shows as typed instead of being run.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value) {
  let text = String(value ?? '');
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// `entries` come from db.listEntries(). Starts with a byte order mark so Excel reads it as UTF-8.
export function entriesCsv(job, entries) {
  const columns = [
    ['Part', 'part'],
    ['Internal ID', 'internalId'],
    ['Department', 'department'],
    ['Division', 'division'],
    ['First Name', 'firstName'],
    ['Last Name', 'lastName'],
    [rateLabelFor(job.commandType), 'rateRank'],
    ['Pay Grade', 'payGrade'],
    ['Street', 'street'],
    ['City', 'city'],
    ['State', 'state'],
    ['ZIP', 'zip'],
    ['Primary Email', 'primaryEmail'],
    ['Secondary Email', 'secondaryEmail'],
    ['Entered (UTC)', 'createdAt'],
  ];
  const rows = [
    columns.map(([label]) => label),
    ...entries.map((entry) => columns.map(([, key]) => entry[key])),
  ];
  return `﻿${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}
