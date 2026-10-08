const views = {
  list: document.getElementById('view-list'),
  form: document.getElementById('view-form'),
  entry: document.getElementById('view-entry'),
  settings: document.getElementById('view-settings'),
};

const jobList = document.getElementById('job-list');
const noJobs = document.getElementById('no-jobs');

const form = document.getElementById('job-form');
const formTitle = document.getElementById('form-title');
const formSubmit = document.getElementById('form-submit');
const formCancel = document.getElementById('form-cancel');
const errorEl = document.getElementById('error');
const commandTypeSelect = document.getElementById('commandType');

const structureSection = document.getElementById('structure');
const structureTable = document.getElementById('structure-table');
const structureRows = document.getElementById('structure-rows');
const structureEmpty = document.getElementById('structure-empty');
const addDepartmentButton = document.getElementById('add-department');
const hodCheckbox = document.getElementById('add-hod');

const entryForm = document.getElementById('entry-form');
const entryJobInfo = document.getElementById('entry-job-info');
const entryDepartment = document.getElementById('entry-department');
const entryDivisionField = document.getElementById('entry-division-field');
const entryDivision = document.getElementById('entry-division');
const entryRateLabel = document.getElementById('entry-rateRank-label');
const entryPayGrade = document.getElementById('entry-payGrade');
const entryError = document.getElementById('entry-error');
const entrySubmit = document.getElementById('entry-submit');
const entrySuccess = document.getElementById('entry-success');
const entryStatus = document.getElementById('entry-status');
const entryStatusText = document.getElementById('entry-status-text');
const entryReprint = document.getElementById('entry-reprint');

const entryBack = document.getElementById('entry-back');
const unlockDialog = document.getElementById('unlock-dialog');
const unlockForm = document.getElementById('unlock-form');
const unlockPassword = document.getElementById('unlock-password');
const unlockError = document.getElementById('unlock-error');
const unlockCancel = document.getElementById('unlock-cancel');

const passwordForm = document.getElementById('password-form');
const newPassword = document.getElementById('new-password');
const passwordStatus = document.getElementById('password-status');

const printerSelect = document.getElementById('printerName');
const refreshButton = document.getElementById('refresh-printers');
const printButton = document.getElementById('print-test');
const printStatus = document.getElementById('print-status');

let currentYear;
let editingId = null; // job id while editing, null while creating
let commandStructures = {}; // default departments and divisions per command type
let structure = []; // the departments being edited: [{ id, name, divisions: [{ id, name }] }]
let shownCommandType = ''; // the command type whose departments are in the editor
let pendingFocus = null; // a department or division whose input should get focus after rendering
let entryJob = null; // the job open on the entry screen
let lastEntryUuid = null; // the entry whose ticket didn't print, for reprinting it
let successTimer = null;

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

function linkButton(text, href, className = 'button') {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.textContent = text;
  return a;
}

// --- Departments and divisions editor ---

const HOD = 'HOD/DLCPO';
const isHod = (div) => div.name.trim().toLowerCase() === HOD.toLowerCase();

// Adds HOD/DLCPO to the end of every department that has at least one other division.
function addHod(departments) {
  for (const dept of departments) {
    if (dept.divisions.some((d) => !isHod(d)) && !dept.divisions.some(isHod)) {
      dept.divisions.push({ id: null, name: HOD });
    }
  }
}

function removeHod(departments) {
  for (const dept of departments) dept.divisions = dept.divisions.filter((d) => !isHod(d));
}

function templateFor(commandType) {
  const departments = (commandStructures[commandType] || []).map((dept) => ({
    id: null,
    name: dept.name,
    divisions: dept.divisions.map((name) => ({ id: null, name })),
  }));
  if (hodCheckbox.checked) addHod(departments);
  return departments;
}

function sameNames(a, b) {
  const names = (list) => JSON.stringify(list.map((d) => [d.name.trim(), d.divisions.map((v) => v.name.trim())]));
  return names(a) === names(b);
}

function nameInput(item, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.required = true;
  input.placeholder = placeholder;
  input.value = item.name;
  input.addEventListener('input', () => { item.name = input.value; });
  if (item === pendingFocus) queueMicrotask(() => input.focus());
  return input;
}

function smallButton(text, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function renderStructure() {
  structureSection.hidden = !commandTypeSelect.value;
  structureTable.hidden = structure.length === 0;
  structureEmpty.hidden = structure.length > 0;

  structureRows.replaceChildren(...structure.map((dept) => {
    const deptCell = document.createElement('td');
    deptCell.className = 'dept';
    deptCell.append(nameInput(dept, 'Department name'));

    const divisions = document.createElement('div');
    divisions.className = 'divisions';
    for (const div of dept.divisions) {
      const chip = document.createElement('span');
      chip.className = 'division';
      chip.append(
        nameInput(div, 'Division'),
        smallButton('×', `Remove division ${div.name}`, () => {
          dept.divisions = dept.divisions.filter((v) => v !== div);
          renderStructure();
        }),
      );
      divisions.append(chip);
    }
    divisions.append(smallButton('+ Division', `Add a division to ${dept.name}`, () => {
      const div = { id: null, name: '' };
      // Keep HOD/DLCPO at the end of the list.
      const last = dept.divisions.length - 1;
      if (last >= 0 && isHod(dept.divisions[last])) dept.divisions.splice(last, 0, div);
      else dept.divisions.push(div);
      pendingFocus = div;
      renderStructure();
    }));
    const divisionsCell = document.createElement('td');
    divisionsCell.append(divisions);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'row-actions';
    actionsCell.append(smallButton('Remove', `Remove department ${dept.name}`, () => {
      const count = dept.divisions.length;
      if (count > 0 && !confirm(`Remove ${dept.name || 'this department'} and its ${count} division${count === 1 ? '' : 's'}?`)) return;
      structure = structure.filter((d) => d !== dept);
      renderStructure();
    }));

    const tr = document.createElement('tr');
    tr.append(deptCell, divisionsCell, actionsCell);
    return tr;
  }));
  pendingFocus = null;
}

function loadStructure(departments, commandType) {
  structure = departments.map((dept) => ({
    id: dept.id,
    name: dept.name,
    divisions: dept.divisions.map((div) => ({ id: div.id, name: div.name })),
  }));
  shownCommandType = commandType;
  hodCheckbox.checked = structure.some((dept) => dept.divisions.some(isHod));
  renderStructure();
}

hodCheckbox.addEventListener('change', () => {
  if (hodCheckbox.checked) addHod(structure);
  else removeHod(structure);
  renderStructure();
});

commandTypeSelect.addEventListener('change', () => {
  const newType = commandTypeSelect.value;
  // Only ask before replacing departments the user has changed from the defaults.
  const unchanged = structure.length === 0 || sameNames(structure, templateFor(shownCommandType));
  if (!unchanged && !confirm(`Switch to the ${newType} departments and divisions? The current list will be replaced.`)) {
    commandTypeSelect.value = shownCommandType;
    return;
  }
  structure = templateFor(newType);
  shownCommandType = newType;
  renderStructure();
});

addDepartmentButton.addEventListener('click', () => {
  const dept = { id: null, name: '', divisions: [] };
  structure.push(dept);
  pendingFocus = dept;
  renderStructure();
});

// Enter in a department or division box shouldn't submit the whole form.
structureSection.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
});

// --- Screens ---

async function showList() {
  const jobs = await window.api.listJobs();
  jobList.replaceChildren(...jobs.map((j) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'job-title';
    title.textContent = `${j.name} (${j.year})`;
    li.append(
      title,
      linkButton('Open', `#/jobs/${j.id}`, 'button primary'),
      linkButton('Edit', `#/jobs/${j.id}/edit`),
    );
    return li;
  }));
  jobList.hidden = jobs.length === 0;
  noJobs.hidden = jobs.length > 0;
  show('list');
}

async function showForm(id) {
  form.reset();
  showError(null);
  const fields = form.elements;

  if (id === null) {
    editingId = null;
    formTitle.textContent = 'Create Job';
    formSubmit.textContent = 'Create Job';
    formCancel.href = '#/jobs';
    fields.year.value = currentYear;
    fields.parts.value = 4;
    loadStructure([], '');
  } else {
    const job = await window.api.getJob(id);
    if (!job) {
      location.hash = '#/jobs';
      return;
    }
    editingId = id;
    formTitle.textContent = 'Edit Job';
    formSubmit.textContent = 'Save Changes';
    formCancel.href = '#/jobs';
    fields.name.value = job.name;
    fields.commandType.value = job.commandType;
    fields.year.value = job.year;
    fields.parts.value = job.parts;
    loadStructure(job.departments, job.commandType);
  }
  show('form');
  fields.name.focus();
}

// --- Data entry ---

// Selected by default, so resetting the form goes back to it rather than the first real option.
function placeholderOption(text) {
  const option = new Option(text, '', true, true);
  option.disabled = true;
  return option;
}

function updateDivisions() {
  const dept = entryJob.departments.find((d) => d.name === entryDepartment.value);
  const divisions = dept ? dept.divisions : [];
  entryDivision.replaceChildren(
    placeholderOption('Select division'),
    ...divisions.map((d) => new Option(d.name, d.name)),
  );
  entryDivisionField.hidden = divisions.length === 0;
  entryDivision.required = divisions.length > 0;
}

async function updateEntryCount() {
  const count = await window.api.countEntries(entryJob.id);
  entryJobInfo.textContent =
    `${entryJob.name} (${entryJob.year}) | ${count} code${count === 1 ? '' : 's'} used`;
}

function showEntryError(message) {
  entryError.textContent = message || '';
  entryError.hidden = !message;
}

function hideSuccess() {
  clearTimeout(successTimer);
  entrySuccess.hidden = true;
}

// Shows the success message next to Submit for 5 seconds, then returns to the top of the
// form for the next person.
function flashSuccess() {
  hideSuccess();
  entrySuccess.hidden = false;
  entrySuccess.scrollIntoView({ block: 'nearest' });
  successTimer = setTimeout(() => {
    entrySuccess.hidden = true;
    if (!views.entry.hidden) {
      window.scrollTo(0, 0);
      entryDepartment.focus();
    }
  }, 5000);
}

function showEntryStatus(message, { error = false, reprint = false } = {}) {
  entryStatusText.textContent = message;
  entryStatus.classList.toggle('error', error);
  entryReprint.hidden = !reprint;
  entryStatus.hidden = false;
  entryStatus.scrollIntoView({ block: 'nearest' });
}

// Locks the form while someone is still owed a ticket, so the next person can't use it until
// the printer is fixed and the ticket reprinted. Reprint stays usable.
function setEntryLocked(locked) {
  for (const el of entryForm.elements) {
    if (el !== entryReprint) el.disabled = locked;
  }
}

function showUnprinted(entry, printError) {
  lastEntryUuid = entry.uuid;
  setEntryLocked(true);
  showEntryStatus(`ERROR: ${printError || "The last ticket didn't print."}`, { error: true, reprint: true });
}

// The ticket printed. A warning (such as low paper) stays up for whoever looks after the kiosk.
function showPrinted(warning) {
  if (warning) showEntryStatus(warning);
  else entryStatus.hidden = true;
  flashSuccess();
}

async function showEntryForm(id) {
  const job = await window.api.getJob(id);
  if (!job) {
    location.hash = '#/jobs';
    return;
  }
  entryJob = job;
  lastEntryUuid = null;
  entryForm.reset();
  showEntryError(null);
  hideSuccess();
  entryStatus.hidden = true;
  entryRateLabel.textContent = await window.api.rateLabel(job.commandType);
  entryDepartment.replaceChildren(
    placeholderOption('Select department'),
    ...job.departments.map((d) => new Option(d.name, d.name)),
  );
  updateDivisions();
  await updateEntryCount();
  show('entry');
  const unprinted = await window.api.unprintedEntry();
  setEntryLocked(Boolean(unprinted));
  if (unprinted) showUnprinted(unprinted, null);
  else entryDepartment.focus();
}

entryDepartment.addEventListener('change', updateDivisions);

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (entrySubmit.disabled) return; // already submitting: don't save twice
  hideSuccess();
  entrySubmit.disabled = true;
  entrySubmit.textContent = 'Submitting…';
  const { error, entry, printError, printWarning } = await window.api.createEntry(
    entryJob.id,
    Object.fromEntries(new FormData(entryForm)),
  );
  entrySubmit.disabled = false;
  entrySubmit.textContent = 'Submit';

  if (error) {
    showEntryError(error);
    entryError.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Saved: clear the form for the next person.
  showEntryError(null);
  entryForm.reset();
  updateDivisions();
  await updateEntryCount();
  if (printError) {
    showUnprinted(entry, printError);
  } else {
    showPrinted(printWarning);
  }
});

entryReprint.addEventListener('click', async () => {
  entryReprint.disabled = true;
  const { printError, printWarning } = await window.api.reprintEntry(lastEntryUuid);
  entryReprint.disabled = false;
  if (printError) {
    showEntryStatus(`ERROR: ${printError}`, { error: true, reprint: true });
  } else {
    lastEntryUuid = null;
    setEntryLocked(false);
    showPrinted(printWarning);
  }
});

// --- Kiosk password ---

// Leaving the entry form needs the kiosk password, if one is set in Settings.
entryBack.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!(await window.api.isPasswordSet())) {
    location.hash = '#/jobs';
    return;
  }
  unlockForm.reset();
  unlockError.hidden = true;
  unlockDialog.showModal();
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await window.api.checkPassword(unlockPassword.value)) {
    unlockDialog.close();
    location.hash = '#/jobs';
  } else {
    unlockError.hidden = false;
    unlockPassword.select();
  }
});

unlockCancel.addEventListener('click', () => unlockDialog.close());

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await window.api.setPassword(newPassword.value);
  passwordStatus.textContent = newPassword.value ? 'Password saved.' : 'Password removed.';
  passwordForm.reset();
});

async function showSettings() {
  printStatus.textContent = '';
  passwordStatus.textContent = '';
  passwordForm.reset();
  show('settings');
  await loadPrinters();
}

// #/jobs, #/jobs/new, #/jobs/:id, #/jobs/:id/edit, #/settings
async function route() {
  const hash = location.hash;
  let match;
  if (hash === '#/settings') return showSettings();
  if (hash === '#/jobs/new') return showForm(null);
  if ((match = hash.match(/^#\/jobs\/(\d+)\/edit$/))) return showForm(Number(match[1]));
  if ((match = hash.match(/^#\/jobs\/(\d+)$/))) return showEntryForm(Number(match[1]));
  if (hash !== '#/jobs') {
    location.hash = '#/jobs'; // triggers route() again via hashchange
    return;
  }
  return showList();
}

window.addEventListener('hashchange', route);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = form.elements;
  const job = {
    name: fields.name.value,
    commandType: fields.commandType.value,
    year: fields.year.value,
    parts: fields.parts.value,
    departments: structure.map((dept) => ({
      id: dept.id,
      name: dept.name,
      divisions: dept.divisions.map((div) => ({ id: div.id, name: div.name })),
    })),
  };
  const { error } = editingId === null
    ? await window.api.createJob(job)
    : await window.api.updateJob(editingId, job);
  showError(error);
  if (error) {
    errorEl.scrollIntoView({ block: 'nearest' });
    return;
  }
  location.hash = '#/jobs';
});

// --- Printer ---

async function loadPrinters() {
  const [printers, current] = await Promise.all([
    window.api.listPrinters(),
    window.api.getPrinterName(),
  ]);
  const options = printers.map((p) => new Option(p.displayName, p.name));
  const installed = printers.some((p) => p.name === current.name);
  if (current.saved && !installed) {
    options.push(new Option(`${current.name} (not found)`, current.name));
  }
  if (options.length === 0) {
    const none = new Option('No printers found', '');
    none.disabled = true;
    options.push(none);
  }
  printerSelect.replaceChildren(...options);
  if (installed || current.saved) printerSelect.value = current.name;
  printButton.disabled = !printerSelect.value;
}

printerSelect.addEventListener('change', () => {
  window.api.setPrinterName(printerSelect.value);
});

refreshButton.addEventListener('click', loadPrinters);

printButton.addEventListener('click', async () => {
  printButton.disabled = true;
  printStatus.className = '';
  printStatus.textContent = 'Printing…';
  const { message, error } = await window.api.printTest(printerSelect.value);
  printStatus.className = error ? 'error' : '';
  printStatus.textContent = error || message;
  printButton.disabled = !printerSelect.value;
});

// --- Start up ---

(async () => {
  const info = await window.api.getInfo();
  currentYear = info.currentYear;
  commandStructures = info.commandStructures;
  for (const type of info.commandTypes) {
    commandTypeSelect.add(new Option(type, type));
  }
  for (const grade of info.payGrades) {
    entryPayGrade.add(new Option(grade, grade));
  }
  await route();
})();
