const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const COMMAND_TYPES = [
  'CVN (Nimitz-class)', 'CVN (Ford-class)', 'CG', 'DDG', 'LCC', 'LCS',
  'LHA', 'LHD', 'LPD', 'LSD', 'The Basic School', 'Other',
];

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'jobs.db'));
// Write-ahead logging: writes go to jobs.db-wal and are merged into jobs.db
// later, so reads don't block on writes. Creates the -wal/-shm side files.
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command_type TEXT NOT NULL,
    year INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
const insertJob = db.prepare(
  'INSERT INTO jobs (name, command_type, year, parts) VALUES (?, ?, ?, ?)'
);
const listJobs = db.prepare(
  'SELECT id, name, command_type AS commandType, year, parts FROM jobs ORDER BY id'
);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; }
    label { display: block; margin-top: 16px; font-weight: 600; }
    input, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; font-size: 1rem; }
    button { margin-top: 24px; padding: 10px 20px; font-size: 1rem; cursor: pointer; }
    .error { color: #b00020; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function createJobPage({ name = '', commandType = '', year, parts = 4, error } = {}) {
  const currentYear = new Date().getFullYear();
  if (year === undefined) year = currentYear;
  const jobs = listJobs.all();
  const list = jobs.length
    ? `<h2>Jobs</h2><ul>${jobs.map((j) =>
        `<li>${escapeHtml(j.name)} — ${escapeHtml(j.commandType)}, ${j.year}, ${j.parts} part${j.parts === 1 ? '' : 's'}</li>`).join('')}</ul>`
    : '';
  return layout('Create Job', `
  <h1>Create Job</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="POST" action="/jobs">
    <label for="name">Job name</label>
    <input id="name" name="name" type="text" required value="${escapeHtml(name)}">

    <label for="commandType">Command Type</label>
    <select id="commandType" name="commandType" required>
      <option value=""${commandType ? '' : ' selected'} disabled>Select a command type</option>
      ${COMMAND_TYPES.map((t) =>
        `<option value="${escapeHtml(t)}"${t === commandType ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
    </select>

    <label for="year">Year</label>
    <input id="year" name="year" type="number" min="1900" max="2100" step="1" required value="${escapeHtml(year)}">

    <label for="parts">Number of parts</label>
    <input id="parts" name="parts" type="number" min="1" step="1" required value="${escapeHtml(parts)}">

    <button type="submit">Create Job</button>
  </form>
  ${list}`);
}

const app = express();
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get(['/', '/jobs/new'], (req, res) => {
  res.send(createJobPage());
});

app.post('/jobs', (req, res) => {
  const name = String(req.body.name || '').trim();
  const commandType = String(req.body.commandType || '');
  const year = Number(req.body.year);
  const parts = Number(req.body.parts);

  let error;
  if (!name) error = 'Job name is required.';
  else if (!COMMAND_TYPES.includes(commandType)) error = 'Please select a command type.';
  else if (!Number.isInteger(year) || year < 1900 || year > 2100) error = 'Year must be between 1900 and 2100.';
  else if (!Number.isInteger(parts) || parts < 1) error = 'Number of parts must be at least 1.';

  if (error) {
    return res.status(400).send(createJobPage({ name, commandType, year: req.body.year, parts: req.body.parts, error }));
  }

  insertJob.run(name, commandType, year, parts);
  res.redirect(303, '/');
});

app.use((req, res) => {
  res.status(404).send(layout('Not Found', '<h1>404 — Not Found</h1><p><a href="/">Create a job</a></p>'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
