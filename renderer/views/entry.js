// The data entry form for an opened job.
import { isShown, placeholderOption, show } from '../dom.js';

const entryForm = document.getElementById('entry-form');
const entryJobInfo = document.getElementById('entry-job-info');
const entryDepartment = document.getElementById('entry-department');
const entryDivisionField = document.getElementById('entry-division-field');
const entryDivision = document.getElementById('entry-division');
const entryRateLabel = document.getElementById('entry-rateRank-label');
const entryPayGrade = document.getElementById('entry-payGrade');
const entryError = document.getElementById('entry-error');
const entrySubmit = document.getElementById('entry-submit');
const entrySuccess = document.getElementById('entry-success');
const entryStatus = document.getElementById('entry-status');
const entryStatusText = document.getElementById('entry-status-text');
const entryReprint = document.getElementById('entry-reprint');

let entryJob = null; // the job open on the entry screen
let lastEntryUuid = null; // the entry whose ticket didn't print, for reprinting it
let successTimer = null;

export function fillPayGrades(payGrades) {
  for (const grade of payGrades) {
    entryPayGrade.add(new Option(grade, grade));
  }
}

function updateDivisions() {
  const dept = entryJob.departments.find((d) => d.name === entryDepartment.value);
  const divisions = dept ? dept.divisions : [];
  entryDivision.replaceChildren(
    placeholderOption('Select division'),
    ...divisions.map((d) => new Option(d.name, d.name)),
  );
  entryDivisionField.hidden = divisions.length === 0;
  entryDivision.required = divisions.length > 0;
}

// Shows how many Internal IDs are left in this kiosk's part. Returns false, with the form locked
// and the reason shown, when there's none to give the next person.
async function updatePartUsage() {
  const usage = await window.api.partUsage(entryJob.id);
  const codes = (n) => `${n} code${n === 1 ? '' : 's'}`;
  const part = usage
    ? `Part ${usage.part} | ${codes(usage.left)} left (${usage.size - usage.left} used)`
    : 'No part chosen';
  entryJobInfo.textContent = `${entryJob.name} (${entryJob.year}) | ${part}`;
  if (usage && usage.left > 0) return true;
  setEntryLocked(true);
  showEntryStatus(usage
    ? `All the Internal IDs in part ${usage.part} have been used.`
    : "This kiosk hasn't been given a part. Go back to Jobs and open the job again to choose one.", { error: true });
  return false;
}

function showEntryError(message) {
  entryError.textContent = message || '';
  entryError.hidden = !message;
}

function hideSuccess() {
  clearTimeout(successTimer);
  entrySuccess.hidden = true;
}

// Shows the success message next to Submit for 5 seconds, then returns to the top of the
// form for the next person.
function flashSuccess() {
  hideSuccess();
  entrySuccess.hidden = false;
  entrySuccess.scrollIntoView({ block: 'nearest' });
  successTimer = setTimeout(() => {
    entrySuccess.hidden = true;
    if (isShown('entry')) {
      window.scrollTo(0, 0);
      entryDepartment.focus();
    }
  }, 5000);
}

function showEntryStatus(message, { error = false, reprint = false } = {}) {
  entryStatusText.textContent = message;
  entryStatus.classList.toggle('error', error);
  entryReprint.hidden = !reprint;
  entryStatus.hidden = false;
  entryStatus.scrollIntoView({ block: 'nearest' });
}

// Locks the form while someone is still owed a ticket, so the next person can't use it until
// the printer is fixed and the ticket reprinted. Reprint stays usable.
function setEntryLocked(locked) {
  for (const el of entryForm.elements) {
    if (el !== entryReprint) el.disabled = locked;
  }
}

function showUnprinted(entry, printError) {
  lastEntryUuid = entry.uuid;
  setEntryLocked(true);
  showEntryStatus(`ERROR: ${printError || "The last ticket didn't print."}`, { error: true, reprint: true });
}

// The ticket printed. A warning (such as low paper) stays up for whoever looks after the kiosk.
function showPrinted(warning) {
  if (warning) showEntryStatus(warning);
  else entryStatus.hidden = true;
  flashSuccess();
}

export async function showEntryForm(id) {
  const job = await window.api.getJob(id);
  if (!job) {
    location.hash = '#/jobs';
    return;
  }
  entryJob = job;
  lastEntryUuid = null;
  entryForm.reset();
  showEntryError(null);
  hideSuccess();
  entryStatus.hidden = true;
  entryRateLabel.textContent = await window.api.rateLabel(job.commandType);
  entryDepartment.replaceChildren(
    placeholderOption('Select department'),
    ...job.departments.map((d) => new Option(d.name, d.name)),
  );
  updateDivisions();
  show('entry');
  const unprinted = await window.api.unprintedEntry();
  setEntryLocked(Boolean(unprinted));
  if (unprinted) {
    await updatePartUsage();
    showUnprinted(unprinted, null);
  } else if (await updatePartUsage()) {
    entryDepartment.focus();
  }
}

entryDepartment.addEventListener('change', updateDivisions);

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (entrySubmit.disabled) return; // already submitting: don't save twice
  hideSuccess();
  entrySubmit.disabled = true;
  entrySubmit.textContent = 'Submitting…';
  const { error, entry, printError, printWarning } = await window.api.createEntry(
    entryJob.id,
    Object.fromEntries(new FormData(entryForm)),
  );
  entrySubmit.disabled = false;
  entrySubmit.textContent = 'Submit';

  if (error) {
    showEntryError(error);
    entryError.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Saved: clear the form for the next person.
  showEntryError(null);
  entryForm.reset();
  updateDivisions();
  if (printError) {
    await updatePartUsage();
    showUnprinted(entry, printError);
  } else {
    showPrinted(printWarning);
    await updatePartUsage();
  }
});

entryReprint.addEventListener('click', async () => {
  entryReprint.disabled = true;
  const { printError, printWarning } = await window.api.reprintEntry(lastEntryUuid);
  entryReprint.disabled = false;
  if (printError) {
    showEntryStatus(`ERROR: ${printError}`, { error: true, reprint: true });
  } else {
    lastEntryUuid = null;
    setEntryLocked(false);
    showPrinted(printWarning);
    await updatePartUsage();
  }
});
