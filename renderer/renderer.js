const form = document.getElementById('job-form');
const errorEl = document.getElementById('error');
const jobsSection = document.getElementById('jobs');
const jobList = document.getElementById('job-list');
const commandTypeSelect = document.getElementById('commandType');
const printerSelect = document.getElementById('printerName');
const refreshButton = document.getElementById('refresh-printers');
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

(async () => {
  const info = await window.api.getInfo();
  currentYear = info.currentYear;
  for (const type of info.commandTypes) {
    commandTypeSelect.add(new Option(type, type));
  }
  resetForm();
  await loadPrinters();
  await renderJobs();
})();
