import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { COMMAND_TYPES } from './command-types.js';
import { PAY_GRADES, rateLabelFor } from './entry-options.js';
import { partNumbers, validateInternalIds } from './internal-ids.js';

// Same message shown in renderer/views/entry.js when updatePartUsage finds no part — keep in sync.
const NO_PART = "This kiosk hasn't been given a part. Go back to Jobs and open the job again to choose one.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

// Returns { error } or { entry } with trimmed fields. The department and division are checked
// against the job's own list, then stored by name.
function validateEntry(job, input) {
  const text = (key) => String(input[key] ?? '').trim();
  const entry = {
    department: text('department'),
    division: text('division'),
    firstName: text('firstName'),
    lastName: text('lastName'),
    rateRank: text('rateRank'),
    payGrade: text('payGrade'),
    street: text('street'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    primaryEmail: text('primaryEmail'),
    secondaryEmail: text('secondaryEmail'),
  };

  // Ensure the department and division are valid for this job, and that required fields are present.
  const dept = job.departments.find((d) => d.name === entry.department);
  if (!dept) return { error: 'Please select a department.' };
  if (dept.divisions.length > 0) {
    if (!dept.divisions.some((d) => d.name === entry.division)) return { error: 'Please select a division.' };
  } else {
    entry.division = '';
  }
  if (!entry.firstName) return { error: 'First name is required.' };
  if (!entry.lastName) return { error: 'Last name is required.' };
  if (!entry.rateRank) return { error: `${rateLabelFor(job.commandType)} is required.` };
  if (!PAY_GRADES.includes(entry.payGrade)) return { error: 'Please select a pay grade.' };
  if (entry.zip && !ZIP_PATTERN.test(entry.zip)) return { error: 'ZIP code must be 5 digits, or 5+4 like 12345-6789.' };
  if (!entry.primaryEmail) return { error: 'Primary email is required.' };
  if (!EMAIL_PATTERN.test(entry.primaryEmail)) return { error: 'Primary email doesn\'t look like an email address.' };
  if (entry.secondaryEmail && !EMAIL_PATTERN.test(entry.secondaryEmail)) return { error: 'Secondary email doesn\'t look like an email address.' };

  return { entry };
}

// Returns { error } or { departments } with trimmed names.
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
      divisions.push({ name: divName });
    }
    departments.push({ name, divisions });
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

  const idCheck = validateInternalIds(input.internalIds ?? []);
  if (idCheck.error) return { error: idCheck.error };
  const { ids } = idCheck;
  if (ids.length === 0) return { error: 'Upload a CSV of Internal IDs.' };
  if (ids.length < parts) {
    return { error: `There are only ${ids.length} Internal ID${ids.length === 1 ? '' : 's'}, not enough for ${parts} parts.` };
  }

  const { error, departments } = validateDepartments(input.departments);
  if (error) return { error };

  return { job: { name, commandType, year, parts, departments, internalIds: ids } };
}

// Schema changes, in order. PRAGMA user_version counts how many have been applied, so each
// runs once per database. Add new steps to the end; never edit one that has shipped.

const MIGRATIONS = [
  // 1: The schema.
  (db) => db.exec(`
    -- uuid is the same on every kiosk. departments is JSON, [{ name, divisions: [{ name }] }],
    -- so a job's departments can be handled as one value. kiosk_part is the part this kiosk
    -- draws Internal IDs from; it's local to this kiosk, so export leaves it out and import
    -- must not overwrite it. No two jobs may share a name (ignoring case) and year.
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      command_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      parts INTEGER NOT NULL,
      kiosk_part INTEGER,
      departments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX jobs_name_year ON jobs (lower(name), year);
    -- People's information entered at the kiosk. Department and division are stored by name,
    -- so later edits to a job's departments don't change past entries. A job that has entries
    -- can't be deleted (no ON DELETE CASCADE), so entries can't disappear with it. Each entry
    -- uses up one of its job's Internal IDs, and the unique index means no two can share one.
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      internal_id TEXT NOT NULL,
      department TEXT NOT NULL,
      division TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      rate_rank TEXT NOT NULL,
      pay_grade TEXT NOT NULL,
      street TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      primary_email TEXT NOT NULL DEFAULT '',
      secondary_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX entries_internal_id ON entries(job_id, internal_id);
    -- The job's Internal IDs from its CSV, in file order, each assigned to one of the job's
    -- parts (1-based) so every kiosk has its own run of IDs.
    CREATE TABLE internal_ids (
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      part INTEGER NOT NULL,
      code TEXT NOT NULL,
      PRIMARY KEY (job_id, position),
      UNIQUE (job_id, code)
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `),
];

function migrate(db) {
  const applied = db.pragma('user_version', { simple: true });
  MIGRATIONS.slice(applied).forEach((step, i) => {
    db.transaction(() => {
      step(db);
      db.pragma(`user_version = ${applied + i + 1}`);
    })();
  });
}

export function openDatabase(file) {
  const db = new Database(file);
  // Write-ahead logging: writes go to kiosk.db-wal and are merged into kiosk.db
  // later, so reads don't block on writes. Creates the -wal/-shm side files.
  db.pragma('journal_mode = WAL');
  // Wait for each write to reach the disk before reporting success.
  db.pragma('synchronous = FULL');
  // Deleting a job also deletes its Internal IDs.
  db.pragma('foreign_keys = ON');
  migrate(db);

  const findDuplicateJob = db.prepare(
    'SELECT id FROM jobs WHERE lower(name) = lower(?) AND year = ? AND id != ?'
  );
  const insertJob = db.prepare(
    'INSERT INTO jobs (uuid, name, command_type, year, parts, departments) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // A kiosk part that no longer exists is cleared, so the kiosk is asked again on Open.
  const updateJob = db.prepare(`
    UPDATE jobs SET name = @name, command_type = @commandType, year = @year, parts = @parts,
                    kiosk_part = CASE WHEN kiosk_part > @parts THEN NULL ELSE kiosk_part END,
                    departments = @departments
    WHERE id = @id
  `);
  const setKioskPart = db.prepare('UPDATE jobs SET kiosk_part = ? WHERE id = ?');
  const listJobs = db.prepare(
    'SELECT id, name, command_type AS commandType, year, parts FROM jobs ORDER BY id DESC'
  );
  const getJob = db.prepare(
    `SELECT id, uuid, name, command_type AS commandType, year, parts, kiosk_part AS kioskPart, departments,
            created_at AS createdAt
     FROM jobs WHERE id = ?`
  );

  const listInternalIds = db.prepare('SELECT code FROM internal_ids WHERE job_id = ? ORDER BY position');
  const insertInternalId = db.prepare('INSERT INTO internal_ids (job_id, position, part, code) VALUES (?, ?, ?, ?)');
  const deleteInternalIds = db.prepare('DELETE FROM internal_ids WHERE job_id = ?');
  const deleteEntries = db.prepare('DELETE FROM entries WHERE job_id = ?');
  const deleteJob = db.prepare('DELETE FROM jobs WHERE id = ?');
  // The first Internal ID in a part that no entry has used yet.
  const nextFreeId = db.prepare(`
    SELECT code FROM internal_ids i
    WHERE job_id = ? AND part = ?
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.job_id = i.job_id AND e.internal_id = i.code)
    ORDER BY position LIMIT 1
  `);
  // Each part's size and how many of its IDs entries have used.
  const listParts = db.prepare(`
    SELECT i.part, count(*) AS size, count(e.internal_id) AS used
    FROM internal_ids i LEFT JOIN entries e ON e.job_id = i.job_id AND e.internal_id = i.code
    WHERE i.job_id = ?
    GROUP BY i.part ORDER BY i.part
  `);
  const getPartUsage = db.prepare(`
    SELECT i.part, count(*) AS size, count(e.internal_id) AS used
    FROM internal_ids i LEFT JOIN entries e ON e.job_id = i.job_id AND e.internal_id = i.code
    WHERE i.job_id = ? AND i.part = ?
    GROUP BY i.part
  `);

  const insertEntry = db.prepare(`
    INSERT INTO entries (uuid, job_id, internal_id, department, division, first_name, last_name, rate_rank,
                         pay_grade, street, city, state, zip, primary_email, secondary_email)
    VALUES (@uuid, @jobId, @internalId, @department, @division, @firstName, @lastName, @rateRank,
            @payGrade, @street, @city, @state, @zip, @primaryEmail, @secondaryEmail)
  `);
  const getEntry = db.prepare(`
    SELECT uuid, job_id AS jobId, internal_id AS internalId, department, division, first_name AS firstName, last_name AS lastName,
           rate_rank AS rateRank, pay_grade AS payGrade, street, city, state, zip,
           primary_email AS primaryEmail, secondary_email AS secondaryEmail, created_at AS createdAt
    FROM entries WHERE uuid = ?
  `);
  const countEntries = db.prepare('SELECT count(*) AS n FROM entries WHERE job_id = ?');

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const putSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  // Replaces a job's Internal IDs, splitting them into its parts.
  function saveInternalIds(jobId, ids, parts) {
    deleteInternalIds.run(jobId);
    const partOf = partNumbers(ids.length, parts);
    ids.forEach((code, i) => insertInternalId.run(jobId, i, partOf[i], code));
  }

  const createJobTx = db.transaction((job) => {
    const jobId = insertJob.run(
      randomUUID(), job.name, job.commandType, job.year, job.parts, JSON.stringify(job.departments),
    ).lastInsertRowid;
    saveInternalIds(jobId, job.internalIds, job.parts);
  });

  const updateJobTx = db.transaction((id, job) => {
    const { changes } = updateJob.run({
      id, name: job.name, commandType: job.commandType, year: job.year, parts: job.parts,
      departments: JSON.stringify(job.departments),
    });
    if (changes === 0) return false;
    saveInternalIds(id, job.internalIds, job.parts);
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
      job.departments = JSON.parse(job.departments);
      job.internalIds = listInternalIds.all(job.id).map((row) => row.code);
      job.entryCount = countEntries.get(job.id).n;
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
      // Entries hold Internal IDs by value, so once there are any, re-splitting or replacing the
      // IDs could hand one out twice.
      const saved = this.getJob(id);
      if (saved?.entryCount > 0 && (job.parts !== saved.parts
          || job.internalIds.join() !== saved.internalIds.join())) {
        return "This job has entries, so its number of parts and Internal IDs can't change.";
      }
      const duplicate = duplicateError(job, Number(id));
      if (duplicate) return duplicate;
      return updateJobTx(Number(id), job) ? null : 'Job not found.';
    },

    // Returns { error } or { entry } once it's saved, with the next free Internal ID from this
    // kiosk's part. Finding and using the ID happen in one transaction, and the unique index on
    // entries(job_id, internal_id) means no two entries can ever get the same one.
    createEntry: db.transaction((jobId, input) => {
      const job = getJob.get(Number(jobId));
      if (!job) return { error: 'Job not found.' };
      job.departments = JSON.parse(job.departments);
      const { error, entry } = validateEntry(job, input);
      if (error) return { error };
      if (!job.kioskPart) return { error: NO_PART };
      const free = nextFreeId.get(job.id, job.kioskPart);
      if (!free) return { error: `All the Internal IDs in part ${job.kioskPart} have been used.` };
      const uuid = randomUUID();
      insertEntry.run({ uuid, jobId: job.id, internalId: free.code, ...entry });
      return { entry: getEntry.get(uuid) };
    }),

    // The job's parts: [{ part, size, left }].
    listParts: (jobId) => listParts.all(Number(jobId)).map(({ used, ...p }) => ({ ...p, left: p.size - used })),

    // How many of the Internal IDs in this kiosk's part are left: { part, size, left },
    // or null if no part has been chosen.
    partUsage(jobId) {
      const job = getJob.get(Number(jobId));
      if (!job?.kioskPart) return null;
      const row = getPartUsage.get(job.id, job.kioskPart);
      return row ? { part: row.part, size: row.size, left: row.size - row.used } : null;
    },

    // Chooses which part this kiosk draws Internal IDs from. Returns an error message or null.
    setKioskPart(jobId, part) {
      const job = getJob.get(Number(jobId));
      if (!job) return 'Job not found.';
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1 || n > job.parts) return 'Choose a part.';
      setKioskPart.run(n, job.id);
      return null;
    },

    // Deletes a job, its Internal IDs, and its entries. Entries don't cascade with their job,
    // so they're only ever removed here, on purpose. Returns false if there was no such job.
    deleteJob: db.transaction((id) => {
      deleteEntries.run(Number(id));
      return deleteJob.run(Number(id)).changes > 0;
    }),

    getEntry: (uuid) => getEntry.get(String(uuid)) || null,

    getSetting(key, fallback) {
      const row = getSetting.get(key);
      return row ? row.value : fallback;
    },
    setSetting: (key, value) => putSetting.run(key, String(value)),

    close: () => db.close(),
  };
}
