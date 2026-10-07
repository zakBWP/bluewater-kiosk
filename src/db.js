const Database = require('better-sqlite3');

const COMMAND_TYPES = [
  'CVN (Nimitz-class)', 'CVN (Ford-class)', 'CG', 'DDG', 'LCC', 'LCS',
  'LHA', 'LHD', 'LPD', 'LSD', 'The Basic School', 'Other',
];

function openDatabase(file) {
  const db = new Database(file);
  // Write-ahead logging: writes go to jobs.db-wal and are merged into jobs.db
  // later, so reads don't block on writes. Creates the -wal/-shm side files.
  db.pragma('journal_mode = WAL');
  // Wait for each write to reach the disk before reporting success.
  db.pragma('synchronous = FULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      command_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      parts INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertJob = db.prepare(
    'INSERT INTO jobs (name, command_type, year, parts) VALUES (?, ?, ?, ?)'
  );
  const listJobs = db.prepare(
    'SELECT id, name, command_type AS commandType, year, parts FROM jobs ORDER BY id'
  );
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const putSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  return {
    listJobs: () => listJobs.all(),

    // Returns an error message, or null once the job is saved.
    createJob(input) {
      const name = String(input.name || '').trim();
      const commandType = String(input.commandType || '');
      const year = Number(input.year);
      const parts = Number(input.parts);

      if (!name) return 'Job name is required.';
      if (!COMMAND_TYPES.includes(commandType)) return 'Please select a command type.';
      if (!Number.isInteger(year) || year < 1900 || year > 2100) return 'Year must be between 1900 and 2100.';
      if (!Number.isInteger(parts) || parts < 1) return 'Number of parts must be at least 1.';

      insertJob.run(name, commandType, year, parts);
      return null;
    },

    getSetting(key, fallback) {
      const row = getSetting.get(key);
      return row ? row.value : fallback;
    },
    setSetting: (key, value) => putSetting.run(key, String(value)),

    close: () => db.close(),
  };
}

module.exports = { openDatabase, COMMAND_TYPES };
