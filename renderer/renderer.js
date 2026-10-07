const views = {
  list: document.getElementById('view-list'),
  form: document.getElementById('view-form'),
  job: document.getElementById('view-job'),
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

function templateFor(commandType) {
  return (commandStructures[commandType] || []).map((dept) => ({
    id: null,
    name: dept.name,
    divisions: dept.divisions.map((name) => ({ id: null, name })),
  }));
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
      dept.divisions.push(div);
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
  renderStructure();
}

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
    formCancel.href = `#/jobs/${id}`;
    fields.name.value = job.name;
    fields.commandType.value = job.commandType;
    fields.year.value = job.year;
    fields.parts.value = job.parts;
    loadStructure(job.departments, job.commandType);
  }
  show('form');
  fields.name.focus();
}

async function showJob(id) {
  const job = await window.api.getJob(id);
  if (!job) {
    location.hash = '#/jobs';
    return;
  }
  document.getElementById('job-name').textContent = job.name;
  document.getElementById('job-commandType').textContent = job.commandType;
  document.getElementById('job-year').textContent = job.year;
  document.getElementById('job-parts').textContent = job.parts;
  // created_at is stored in UTC by SQLite.
  document.getElementById('job-created').textContent =
    new Date(job.createdAt.replace(' ', 'T') + 'Z').toLocaleString();
  const rows = job.departments.map((dept) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = dept.name;
    const divisions = document.createElement('td');
    divisions.textContent = dept.divisions.map((d) => d.name).join(', ') || '—';
    tr.append(name, divisions);
    return tr;
  });
  document.getElementById('job-structure-rows').replaceChildren(...rows);
  document.getElementById('job-structure').hidden = rows.length === 0;
  document.getElementById('job-structure-empty').hidden = rows.length > 0;
  document.getElementById('job-edit').href = `#/jobs/${id}/edit`;
  show('job');
}

// #/jobs, #/jobs/new, #/jobs/:id, #/jobs/:id/edit
async function route() {
  const hash = location.hash;
  let match;
  if (hash === '#/jobs/new') return showForm(null);
  if ((match = hash.match(/^#\/jobs\/(\d+)\/edit$/))) return showForm(Number(match[1]));
  if ((match = hash.match(/^#\/jobs\/(\d+)$/))) return showJob(Number(match[1]));
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
  if (error) return;
  location.hash = editingId === null ? '#/jobs' : `#/jobs/${editingId}`;
});

// --- Printer ---

async function loadPrinters() {
  const [printers, current] = await Promise.all([
    window.api.listPrinters(),
    window.api.getPrinterName(),
  ]);
  const options = printers.map((p) => new Option(
    p.displayName === p.name ? p.name : `${p.displayName} (${p.name})`,
    p.name,
  ));
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
  await loadPrinters();
  await route();
})();
