// Start-up and routing. Each screen lives in its own module under views/.
import { app } from './dom.js';
import { showList } from './views/jobs.js';
import { fillCommandTypes, showForm } from './views/job-form.js';
import { fillPayGrades, showEntryForm } from './views/entry.js';
import { showSettings } from './views/settings.js';
import './views/unlock-dialog.js';

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

(async () => {
  const info = await window.api.getInfo();
  app.currentYear = info.currentYear;
  app.commandStructures = info.commandStructures;
  fillCommandTypes(info.commandTypes);
  fillPayGrades(info.payGrades);
  await route();
})();
