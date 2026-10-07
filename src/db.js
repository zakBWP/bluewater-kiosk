import Database from 'better-sqlite3';
import { COMMAND_TYPES } from './command-types.js';

function optionalId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Returns { error } or { departments } with trimmed names. Each department and division keeps
// its id (or null if it's new), so saving an edit can update rows in place.
function validateDepartments(input) {
  if (input === undefined || input === null) return { departments: [] };
  if (!Array.isArray(input)) return { error: 'Departments are invalid.' };

  const departments = [];
  const departmentNames = new Set();
  for (const [i, dept] of input.entries()) {
    const name = String(dept?.name || '').trim();
    if (!name) return { error: `Department ${i + 1} needs a name.` };
    if (departmentNames.has(name.toLowerCase())) return { error: `There are two departments named "${name}".` };
    departmentNames.add(name.toLowerCase());

    const divisions = [];
    const divisionNames = new Set();
    for (const div of Array.isArray(dept.divisions) ? dept.divisions : []) {
      const divName = String(div?.name || '').trim();
      if (!divName) return { error: `A division in ${name} needs a name.` };
      if (divisionNames.has(divName.toLowerCase())) return { error: `${name} has two divisions named "${divName}".` };
      divisionNames.add(divName.toLowerCase());
      divisions.push({ id: optionalId(div.id), name: divName });
    }
    departments.push({ id: optionalId(dept.id), name, divisions });
  }
  return { departments };
}

// Returns { error } or { job } with cleaned-up fields.
function validateJob(input) {
  const name = String(input.name || '').trim();
  const commandType = String(input.commandType || '');
  const year = Number(input.year);
  const parts = Number(input.parts);

  if (!name) return { error: 'Job name is required.' };
  if (!COMMAND_TYPES.includes(commandType)) return { error: 'Please select a command type.' };
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return { error: 'Year must be between 1900 and 2100.' };
  if (!Number.isInteger(parts) || parts < 1) return { error: 'Number of parts must be at least 1.' };

  const { error, departments } = validateDepartments(input.departments);
  if (error) return { error };

  return { job: { name, commandType, year, parts, departments } };
}

export function openDatabase(file) {
  const db = new Database(file);
  // Write-ahead logging: writes go to jobs.db-wal and are merged into jobs.db
  // later, so reads don't block on writes. Creates the -wal/-shm side files.
  db.pragma('journal_mode = WAL');
  // Wait for each write to reach the disk before reporting success.
  db.pragma('synchronous = FULL');
  // Deleting a job or department also deletes what belongs to it.
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      command_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      parts INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS departments_job ON departments(job_id);
    CREATE INDEX IF NOT EXISTS divisions_department ON divisions(department_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // No two jobs may share a name (ignoring case) and year. This fails while duplicates from
  // before the rule exist; the check in createJob/updateJob still applies, and the index
  // is added on a later start once they're gone.
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS jobs_name_year ON jobs (lower(name), year)');
  } catch (err) {
    if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
  }

  const findDuplicateJob = db.prepare(
    'SELECT id FROM jobs WHERE lower(name) = lower(?) AND year = ? AND id != ?'
  );
  const insertJob = db.prepare(
    'INSERT INTO jobs (name, command_type, year, parts) VALUES (?, ?, ?, ?)'
  );
  const updateJob = db.prepare(
    'UPDATE jobs SET name = ?, command_type = ?, year = ?, parts = ? WHERE id = ?'
  );
  const listJobs = db.prepare(
    'SELECT id, name, command_type AS commandType, year, parts FROM jobs ORDER BY id'
  );
  const getJob = db.prepare(
    'SELECT id, name, command_type AS commandType, year, parts, created_at AS createdAt FROM jobs WHERE id = ?'
  );

  const listDepartments = db.prepare('SELECT id, name FROM departments WHERE job_id = ? ORDER BY position');
  const insertDepartment = db.prepare('INSERT INTO departments (job_id, name, position) VALUES (?, ?, ?)');
  const updateDepartment = db.prepare('UPDATE departments SET name = ?, position = ? WHERE id = ?');
  const deleteDepartment = db.prepare('DELETE FROM departments WHERE id = ?');

  const listDivisions = db.prepare('SELECT id, name FROM divisions WHERE department_id = ? ORDER BY position');
  const insertDivision = db.prepare('INSERT INTO divisions (department_id, name, position) VALUES (?, ?, ?)');
  const updateDivision = db.prepare('UPDATE divisions SET name = ?, position = ? WHERE id = ?');
  const deleteDivision = db.prepare('DELETE FROM divisions WHERE id = ?');

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const putSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  // Makes a job's departments and divisions match the given list. Rows with a known id are
  // updated in place, rows without one are added, and rows that are no longer listed are deleted.
  function saveDepartments(jobId, departments) {
    const existingDepartments = new Set(listDepartments.all(jobId).map((d) => d.id));
    departments.forEach((dept, i) => {
      let deptId = dept.id;
      if (existingDepartments.has(deptId)) {
        updateDepartment.run(dept.name, i, deptId);
        existingDepartments.delete(deptId);
      } else {
        deptId = insertDepartment.run(jobId, dept.name, i).lastInsertRowid;
      }

      const existingDivisions = new Set(listDivisions.all(deptId).map((d) => d.id));
      dept.divisions.forEach((div, j) => {
        if (existingDivisions.has(div.id)) {
          updateDivision.run(div.name, j, div.id);
          existingDivisions.delete(div.id);
        } else {
          insertDivision.run(deptId, div.name, j);
        }
      });
      for (const id of existingDivisions) deleteDivision.run(id);
    });
    for (const id of existingDepartments) deleteDepartment.run(id);
  }

  const createJobTx = db.transaction((job) => {
    const jobId = insertJob.run(job.name, job.commandType, job.year, job.parts).lastInsertRowid;
    saveDepartments(jobId, job.departments);
  });

  const updateJobTx = db.transaction((id, job) => {
    const { changes } = updateJob.run(job.name, job.commandType, job.year, job.parts, id);
    if (changes === 0) return false;
    saveDepartments(id, job.departments);
    return true;
  });

  function duplicateError(job, id = 0) {
    return findDuplicateJob.get(job.name, job.year, id)
      ? `A job named "${job.name}" for ${job.year} already exists.`
      : null;
  }

  return {
    listJobs: () => listJobs.all(),

    getJob(id) {
      const job = getJob.get(Number(id));
      if (!job) return null;
      job.departments = listDepartments.all(job.id).map((dept) => ({
        ...dept,
        divisions: listDivisions.all(dept.id),
      }));
      return job;
    },

    // Returns an error message, or null once the job is saved.
    createJob(input) {
      const { error, job } = validateJob(input);
      if (error) return error;
      const duplicate = duplicateError(job);
      if (duplicate) return duplicate;
      createJobTx(job);
      return null;
    },

    // Returns an error message, or null once the job is saved.
    updateJob(id, input) {
      const { error, job } = validateJob(input);
      if (error) return error;
      const duplicate = duplicateError(job, Number(id));
      if (duplicate) return duplicate;
      return updateJobTx(Number(id), job) ? null : 'Job not found.';
    },

    getSetting(key, fallback) {
      const row = getSetting.get(key);
      return row ? row.value : fallback;
    },
    setSetting: (key, value) => putSetting.run(key, String(value)),

    close: () => db.close(),
  };
}
