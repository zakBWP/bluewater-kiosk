// The jobs list: the start screen.
import { isShown, linkButton, show } from '../dom.js';
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

// Imports a job from a .bwp file's text. Shows any problem above the jobs list, and refreshes
// the list if it's on screen; files opened from outside never change the screen, so they
// can't be used to leave the entry form without the kiosk password.
async function importJobFile(name, text) {
  const fail = (message) => {
    importError.textContent = message;
    importError.hidden = false;
  };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(`${name}: not a valid job file.`);
  }
  if (!data?.bluewaterKiosk || !data?.job) return fail(`${name}: not a valid job file.`);
  const { error } = await window.api.createJob(data.job);
  if (error) return fail(error);
  importError.hidden = true;
  if (isShown('list')) await showList();
}

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (file) await importJobFile(file.name, await file.text());
});

// .bwp files opened from Explorer or Finder, including the one the app was started with.
window.api.onOpenFile(({ name, text }) => importJobFile(name, text));
