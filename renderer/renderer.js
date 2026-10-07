const form = document.getElementById('job-form');
const errorEl = document.getElementById('error');
const jobsSection = document.getElementById('jobs');
const jobList = document.getElementById('job-list');
const commandTypeSelect = document.getElementById('commandType');
const printerNameInput = document.getElementById('printerName');
const printButton = document.getElementById('print-test');
const printStatus = document.getElementById('print-status');

let currentYear;

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

async function renderJobs() {
  const jobs = await window.api.listJobs();
  jobList.replaceChildren(...jobs.map((j) => {
    const li = document.createElement('li');
    li.textContent = `${j.name} — ${j.commandType}, ${j.year}, ${j.parts} part${j.parts === 1 ? '' : 's'}`;
    return li;
  }));
  jobsSection.hidden = jobs.length === 0;
}

function resetForm() {
  form.reset();
  form.elements.year.value = currentYear;
  form.elements.parts.value = 4;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = form.elements;
  const { error } = await window.api.createJob({
    name: fields.name.value,
    commandType: fields.commandType.value,
    year: fields.year.value,
    parts: fields.parts.value,
  });
  showError(error);
  if (error) return;
  resetForm();
  await renderJobs();
});

printButton.addEventListener('click', async () => {
  printButton.disabled = true;
  printStatus.className = '';
  printStatus.textContent = 'Printing…';
  const { message, error } = await window.api.printTest(printerNameInput.value);
  printStatus.className = error ? 'error' : '';
  printStatus.textContent = error || message;
  printButton.disabled = false;
});

(async () => {
  const info = await window.api.getInfo();
  currentYear = info.currentYear;
  for (const type of info.commandTypes) {
    commandTypeSelect.add(new Option(type, type));
  }
  resetForm();
  printerNameInput.value = await window.api.getPrinterName();
  await renderJobs();
})();
