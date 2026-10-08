// Opening a job from the jobs list first asks which part of its Internal IDs this kiosk uses.

const partDialog = document.getElementById('part-dialog');
const partForm = document.getElementById('part-form');
const partTitle = document.getElementById('part-title');
const partOptions = document.getElementById('part-options');
const partError = document.getElementById('part-error');
const partOpen = document.getElementById('part-open');
const partCancel = document.getElementById('part-cancel');

let openingJob = null;

function partOption({ part, size, left }, chosen) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'part';
  input.value = part;
  input.required = true;
  input.checked = part === chosen && left > 0;
  input.disabled = left === 0; // a used-up part has nothing left to give out

  const detail = document.createElement('span');
  detail.className = 'part-detail';
  detail.textContent = left === 0 ? 'all used' : `${left} of ${size} left`;
  const text = document.createElement('span');
  text.className = 'part-text';
  text.append(`Part ${part}`, detail);

  const label = document.createElement('label');
  label.className = 'checkbox';
  label.append(input, text);
  return label;
}

export async function choosePart(job) {
  const [parts, current] = await Promise.all([
    window.api.listParts(job.id),
    window.api.partUsage(job.id),
  ]);
  openingJob = job;
  partTitle.textContent = `Which part does this kiosk use for ${job.name}?`;
  partOptions.replaceChildren(...parts.map((p) => partOption(p, current?.part)));
  partError.hidden = true;
  updateOpen();
  partDialog.showModal();
}

// Open stays disabled until a part is selected.
function updateOpen() {
  partOpen.disabled = !partForm.querySelector('input[name="part"]:checked');
}

partOptions.addEventListener('change', updateOpen);

partForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { error } = await window.api.setKioskPart(openingJob.id, partForm.elements.part.value);
  if (error) {
    partError.textContent = error;
    partError.hidden = false;
    return;
  }
  partDialog.close();
  location.hash = `#/jobs/${openingJob.id}`;
});

partCancel.addEventListener('click', () => partDialog.close());
