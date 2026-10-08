// The Settings screen: printer and kiosk password.
import { show } from '../dom.js';

const printerSelect = document.getElementById('printerName');
const refreshButton = document.getElementById('refresh-printers');
const printButton = document.getElementById('print-test');
const printStatus = document.getElementById('print-status');

const passwordForm = document.getElementById('password-form');
const newPassword = document.getElementById('new-password');
const passwordStatus = document.getElementById('password-status');

export async function showSettings() {
  printStatus.textContent = '';
  passwordStatus.textContent = '';
  passwordForm.reset();
  show('settings');
  await loadPrinters();
}

// --- Printer ---

async function loadPrinters() {
  const [printers, current] = await Promise.all([
    window.api.listPrinters(),
    window.api.getPrinterName(),
  ]);
  const options = printers.map((p) => new Option(p.displayName, p.name));
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

// --- Kiosk password ---

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await window.api.setPassword(newPassword.value);
  passwordStatus.textContent = newPassword.value ? 'Password saved.' : 'Password removed.';
  passwordForm.reset();
});
