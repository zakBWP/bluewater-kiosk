// The jobs list: the start screen.
import { linkButton, show } from '../dom.js';
import { choosePart } from './part-dialog.js';

const jobList = document.getElementById('job-list');
const noJobs = document.getElementById('no-jobs');
const importInput = document.getElementById('import-input');
const importButton = document.getElementById('import-job');
const importError = document.getElementById('import-error');

function openButton(job) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary';
  button.textContent = 'Open';
  button.addEventListener('click', () => choosePart(job));
  return button;
}

function exportButton(job) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = 'Export';
  button.addEventListener('click', () => exportJob(job));
  return button;
}

async function exportJob(job) {
  const full = await window.api.getJob(job.id);
  const data = {
    bluewaterKiosk: true,
    version: 1,
    job: {
      name: full.name,
      commandType: full.commandType,
      year: full.year,
      parts: full.parts,
      departments: full.departments,
      internalIds: full.internalIds,
    },
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `${full.name} ${full.year}.bwp`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function showList() {
  const jobs = await window.api.listJobs();
  jobList.replaceChildren(...jobs.map((j) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'job-title';
    title.textContent = `${j.name} (${j.year})`;
    li.append(
      title,
      openButton(j),
      linkButton('Edit', `#/jobs/${j.id}/edit`),
      exportButton(j),
    );
    return li;
  }));
  jobList.hidden = jobs.length === 0;
  noJobs.hidden = jobs.length > 0;
  show('list');
}

importButton.addEventListener('click', () => {
  importInput.value = '';
  importError.hidden = true;
  importInput.click();
});

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    importError.textContent = `${file.name}: not a valid job file.`;
    importError.hidden = false;
    return;
  }
  if (!data?.bluewaterKiosk || !data?.job) {
    importError.textContent = `${file.name}: not a valid job file.`;
    importError.hidden = false;
    return;
  }
  const { error } = await window.api.createJob(data.job);
  if (error) {
    importError.textContent = error;
    importError.hidden = false;
    return;
  }
  importError.hidden = true;
  await showList();
});
