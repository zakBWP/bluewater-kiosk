// The Create Job / Edit Job screen.
import { app, show } from '../dom.js';
import { getStructure, loadStructure } from './structure-editor.js';

const form = document.getElementById('job-form');
const formTitle = document.getElementById('form-title');
const formSubmit = document.getElementById('form-submit');
const formCancel = document.getElementById('form-cancel');
const errorEl = document.getElementById('error');
const commandTypeSelect = document.getElementById('commandType');

let editingId = null; // job id while editing, null while creating

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

export function fillCommandTypes(commandTypes) {
  for (const type of commandTypes) {
    commandTypeSelect.add(new Option(type, type));
  }
}

export async function showForm(id) {
  form.reset();
  showError(null);
  const fields = form.elements;

  if (id === null) {
    editingId = null;
    formTitle.textContent = 'Create Job';
    formSubmit.textContent = 'Create Job';
    formCancel.href = '#/jobs';
    fields.year.value = app.currentYear;
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = form.elements;
  const job = {
    name: fields.name.value,
    commandType: fields.commandType.value,
    year: fields.year.value,
    parts: fields.parts.value,
    departments: getStructure(),
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
