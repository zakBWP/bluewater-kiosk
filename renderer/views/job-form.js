// The Create Job / Edit Job screen.
import { app, show } from '../dom.js';
import { getStructure, loadStructure } from './structure-editor.js';

const form = document.getElementById('job-form');
const formTitle = document.getElementById('form-title');
const formSubmit = document.getElementById('form-submit');
const formCancel = document.getElementById('form-cancel');
const formDelete = document.getElementById('form-delete');
const formDownload = document.getElementById('form-download');
const errorEl = document.getElementById('error');
const commandTypeSelect = document.getElementById('commandType');
const partsInput = document.getElementById('parts');
const idCsv = document.getElementById('idCsv');
const idSummary = document.getElementById('id-summary');
const idStatus = document.getElementById('id-status');
const idParts = document.getElementById('id-parts');
const idsLocked = document.getElementById('ids-locked');

let editingId = null; // job id while editing, null while creating
let internalIds = []; // verified IDs from the CSV, or the job's saved ones while editing
let csvError = null; // why the chosen CSV was rejected
let editingJob = null; // the saved job while editing, for the Delete Job confirmation

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

export function fillCommandTypes(commandTypes) {
  for (const type of commandTypes) {
    commandTypeSelect.add(new Option(type, type));
  }
}

// Sizes of each part when `count` IDs are split into `parts`. Matches partNumbers() in
// src/internal-ids.js, which does the real split when the job is saved.
function partSizes(count, parts) {
  return Array.from({ length: parts }, (_, i) => Math.floor(count / parts) + (i < count % parts ? 1 : 0));
}

function setIdStatus(text, ok) {
  idStatus.textContent = text;
  idStatus.className = ok ? 'ok' : 'error';
  idSummary.hidden = !text;
}

// Shows how the IDs split into parts, and allows saving only once there's a verified CSV and a
// usable number of parts.
function updateIds() {
  const parts = Number(partsInput.value);
  const partsOk = Number.isInteger(parts) && parts >= 1;
  const count = internalIds.length;
  idParts.replaceChildren();
  let ready = false;

  if (csvError) {
    setIdStatus(csvError, false);
  } else if (count === 0) {
    setIdStatus('', true);
  } else if (!partsOk) {
    setIdStatus(`${count.toLocaleString()} Internal IDs verified. Enter the number of parts to split them into.`, false);
  } else if (count < parts) {
    setIdStatus(`There are only ${count.toLocaleString()} Internal ID${count === 1 ? '' : 's'}, not enough for ${parts} parts.`, false);
  } else {
    setIdStatus(`${count.toLocaleString()} Internal IDs verified, split into ${parts} part${parts === 1 ? '' : 's'}:`, true);
    idParts.replaceChildren(...partSizes(count, parts).map((size) => {
      const li = document.createElement('li');
      li.textContent = `${size.toLocaleString()} IDs`;
      return li;
    }));
    ready = true;
  }
  formSubmit.disabled = !ready;
}

partsInput.addEventListener('input', updateIds);

idCsv.addEventListener('change', async () => {
  const file = idCsv.files[0];
  if (!file) return;
  formSubmit.disabled = true;
  setIdStatus(`Checking ${file.name}…`, true);
  const { error, ids } = await window.api.readIdCsv(await file.text());
  if (idCsv.files[0] !== file) return; // another file was chosen meanwhile
  csvError = error ? `${file.name}: ${error}` : null;
  if (!error) internalIds = ids;
  updateIds();
});

// Once a job has entries, its parts and Internal IDs are fixed.
function setIdsLocked(locked) {
  partsInput.disabled = locked;
  idCsv.disabled = locked;
  idsLocked.hidden = !locked;
}

export async function showForm(id) {
  form.reset();
  showError(null);
  csvError = null;
  const fields = form.elements;

  if (id === null) {
    editingId = null;
    editingJob = null;
    formDelete.hidden = true;
    formDownload.hidden = true;
    formTitle.textContent = 'Create Job';
    formSubmit.textContent = 'Create Job';
    formCancel.href = '#/jobs';
    fields.year.value = app.currentYear;
    fields.parts.value = 4;
    internalIds = [];
    setIdsLocked(false);
    loadStructure([], '');
  } else {
    const job = await window.api.getJob(id);
    if (!job) {
      location.hash = '#/jobs';
      return;
    }
    editingId = id;
    editingJob = job;
    formDelete.hidden = false;
    formDownload.hidden = false;
    formTitle.textContent = 'Edit Job';
    formSubmit.textContent = 'Save Changes';
    formCancel.href = '#/jobs';
    fields.name.value = job.name;
    fields.commandType.value = job.commandType;
    fields.year.value = job.year;
    fields.parts.value = job.parts;
    internalIds = job.internalIds;
    setIdsLocked(job.entryCount > 0);
    loadStructure(job.departments, job.commandType);
  }
  updateIds();
  show('form');
  fields.name.focus();
}

formDelete.addEventListener('click', async () => {
  const { name, year, entryCount } = editingJob;
  const lost = entryCount > 0
    ? ` Its ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} will be deleted too.`
    : '';
  if (!confirm(`Delete ${name} (${year})?${lost} This can't be undone.`)) return;
  await window.api.deleteJob(editingId);
  location.hash = '#/jobs';
});

// Downloads every entry recorded for this job on this kiosk as a CSV.
formDownload.addEventListener('click', async () => {
  const csv = await window.api.entriesCsv(editingId);
  if (csv === null) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${editingJob.name} ${editingJob.year} data.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = form.elements;
  const job = {
    name: fields.name.value,
    commandType: fields.commandType.value,
    year: fields.year.value,
    parts: fields.parts.value,
    departments: getStructure(),
    internalIds,
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
