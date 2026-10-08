// The jobs list: the start screen.
import { linkButton, show } from '../dom.js';

const jobList = document.getElementById('job-list');
const noJobs = document.getElementById('no-jobs');

export async function showList() {
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
