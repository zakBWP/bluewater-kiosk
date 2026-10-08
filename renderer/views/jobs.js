// The jobs list: the start screen.
import { linkButton, show } from '../dom.js';
import { choosePart } from './part-dialog.js';

const jobList = document.getElementById('job-list');
const noJobs = document.getElementById('no-jobs');

function openButton(job) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary';
  button.textContent = 'Open';
  button.addEventListener('click', () => choosePart(job));
  return button;
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
    );
    return li;
  }));
  jobList.hidden = jobs.length === 0;
  noJobs.hidden = jobs.length > 0;
  show('list');
}
