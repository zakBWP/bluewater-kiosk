// The Settings screen: printer, kiosk password, updates, and quitting the kiosk.
import { app, show } from '../dom.js';

const printerSelect = document.getElementById('printerName');
const refreshButton = document.getElementById('refresh-printers');
const printButton = document.getElementById('print-test');
const printStatus = document.getElementById('print-status');

const passwordForm = document.getElementById('password-form');
const newPassword = document.getElementById('new-password');
const passwordStatus = document.getElementById('password-status');
const versionText = document.getElementById('app-version');
const checkButton = document.getElementById('check-updates');
const installButton = document.getElementById('install-update');
const updateStatus = document.getElementById('update-status');
const quitButton = document.getElementById('quit-app');

quitButton.addEventListener('click', () => window.api.quit());

export async function showSettings() {
  printStatus.textContent = '';
  passwordStatus.textContent = '';
  passwordForm.reset();
  versionText.textContent = `Version ${app.version}`;
  setUpdateStatus('');
  checkButton.disabled = false;
  installButton.disabled = false;
  installButton.hidden = true;
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
  // Entries print to the saved name, so save whatever the dropdown fell back to showing.
  if (!current.saved && printerSelect.value) window.api.setPrinterName(printerSelect.value);
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

// --- Updates ---

function setUpdateStatus(text, error = false) {
  updateStatus.className = error ? 'error' : '';
  updateStatus.textContent = text;
}

checkButton.addEventListener('click', async () => {
  checkButton.disabled = true;
  installButton.hidden = true;
  setUpdateStatus('Checking for updates…');
  const { available, message, error } = await window.api.checkForUpdates();
  checkButton.disabled = false;
  if (available) {
    setUpdateStatus(`Version ${available} is available. The application restarts to install it.`);
    installButton.hidden = false;
  } else {
    setUpdateStatus(error || message, Boolean(error));
  }
});

// On success the app closes and reopens on the new version, so only a failure comes back.
installButton.addEventListener('click', async () => {
  checkButton.disabled = true;
  installButton.disabled = true;
  setUpdateStatus('Downloading the update…');
  const { error } = await window.api.installUpdate();
  if (error) {
    setUpdateStatus(error, true);
    checkButton.disabled = false;
    installButton.disabled = false;
  }
});
