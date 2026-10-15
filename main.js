import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import electronUpdater from 'electron-updater';
import { openDatabase } from './src/db.js';
import { COMMAND_TYPES, COMMAND_STRUCTURES } from './src/command-types.js';
import { PAY_GRADES, rateLabelFor } from './src/entry-options.js';
import { entriesCsv } from './src/entries-csv.js';
import { readInternalIdCsv } from './src/internal-ids.js';
import { DEFAULT_PRINTER_NAME, printEntryTicket, printTestReceipt } from './src/printer.js';

const { autoUpdater } = electronUpdater;

let db;

// Updates come from the GitHub Releases named under "publish" in package.json, but only when
// someone asks for them in Settings: nothing is checked, downloaded or installed on its own.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// Failures reach Settings through the rejected promises below; without a listener, the
// updater's own 'error' event would crash the app.
autoUpdater.on('error', () => {});

// `npm run dev` opens an ordinary window with the default menu (Reload, Developer Tools, ...)
// for working on the app. Otherwise it runs as a full-screen kiosk with no menu.
const WINDOWED = process.argv.includes('--windowed');

// macOS handles copy, paste and undo in text fields through the Edit menu's shortcuts, so the
// kiosk keeps an Edit menu; it's never visible in kiosk mode. Leaving out the rest removes
// Reload, Developer Tools and Quit. Elsewhere those shortcuts work without a menu.
function kioskMenu() {
  if (process.platform !== 'darwin') return null;
  return Menu.buildFromTemplate([{ role: 'appMenu', submenu: [] }, { role: 'editMenu' }]);
}

const PAPER_LOW = 'The printer paper is running low. Load a new roll soon.';
const UNPRINTED = 'unprintedEntry'; // setting: uuid of the entry whose ticket failed to print
const PASSWORD = 'kioskPassword'; // setting: "salt:hash" (hex) of the password for leaving the form

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 32);
}

function checkPassword(password) {
  const stored = db.getSetting(PASSWORD, '');
  if (!stored) return true;
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(hashPassword(password, Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
}

// The entry whose ticket failed to print, or null. The form stays locked until it prints, so
// the next person can't take the printer while someone is still owed a ticket.
function unprintedEntry() {
  const uuid = db.getSetting(UNPRINTED, '');
  return uuid ? db.getEntry(uuid) : null;
}

// Prints an entry's ticket on the chosen printer and records whether it's still owed.
// Returns { printError, printWarning }.
async function printTicket(entry) {
  const job = db.getJob(entry.jobId);
  try {
    const { paperLow } = await printEntryTicket(db.getSetting('printerName', DEFAULT_PRINTER_NAME), { job, entry });
    db.setSetting(UNPRINTED, '');
    return { printError: null, printWarning: paperLow ? PAPER_LOW : null };
  } catch (err) {
    db.setSetting(UNPRINTED, entry.uuid);
    return { printError: err.message, printWarning: null };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 800,
    kiosk: !WINDOWED,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(import.meta.dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  db = openDatabase(process.env.DB_PATH || path.join(app.getPath('userData'), 'kiosk.db'));
  if (!WINDOWED) Menu.setApplicationMenu(kioskMenu());

  ipcMain.handle('app:info', () => ({
    commandTypes: COMMAND_TYPES,
    commandStructures: COMMAND_STRUCTURES,
    payGrades: PAY_GRADES,
    rateLabels: Object.fromEntries(COMMAND_TYPES.map((t) => [t, rateLabelFor(t)])),
    currentYear: new Date().getFullYear(),
    version: app.getVersion(),
  }));
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('jobs:list', () => db.listJobs());
  ipcMain.handle('jobs:get', (event, id) => db.getJob(id));
  ipcMain.handle('jobs:create', (event, input) => ({ error: db.createJob(input) }));
  ipcMain.handle('jobs:update', (event, id, input) => ({ error: db.updateJob(id, input) }));
  ipcMain.handle('jobs:delete', (event, id) => db.deleteJob(id));
  ipcMain.handle('jobs:readIdCsv', (event, text) => readInternalIdCsv(text));
  ipcMain.handle('jobs:entriesCsv', (event, id) => {
    const job = db.getJob(id);
    return job ? entriesCsv(job, db.listEntries(job.id)) : null;
  });
  // The entry is saved before printing, so a printer problem never loses data.
  ipcMain.handle('entries:create', async (event, jobId, input) => {
    if (unprintedEntry()) return { error: "The last ticket hasn't printed yet. Fix the printer and press Reprint." };
    const { error, entry } = db.createEntry(jobId, input);
    if (error) return { error };
    return { entry, ...(await printTicket(entry)) };
  });
  ipcMain.handle('entries:reprint', async (event, uuid) => {
    const entry = db.getEntry(uuid);
    if (!entry) return { printError: 'Entry not found.' };
    return printTicket(entry);
  });
  ipcMain.handle('entries:unprinted', () => unprintedEntry());
  ipcMain.handle('jobs:listParts', (event, jobId) => db.listParts(jobId));
  ipcMain.handle('jobs:setKioskPart', (event, jobId, part) => ({ error: db.setKioskPart(jobId, part) }));
  ipcMain.handle('entries:partUsage', (event, jobId) => db.partUsage(jobId));
  ipcMain.handle('password:isSet', () => db.getSetting(PASSWORD, '') !== '');
  ipcMain.handle('password:check', (event, password) => checkPassword(password));
  // A blank password removes it.
  ipcMain.handle('password:set', (event, password) => {
    if (!password) return db.setSetting(PASSWORD, '');
    const salt = randomBytes(16);
    db.setSetting(PASSWORD, `${salt.toString('hex')}:${hashPassword(password, salt).toString('hex')}`);
  });
  ipcMain.handle('printer:list', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers
      .map(({ name, displayName }) => ({ name, displayName: displayName || name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
  ipcMain.handle('printer:getName', () => {
    const saved = db.getSetting('printerName', null);
    return { name: saved || DEFAULT_PRINTER_NAME, saved: saved !== null };
  });
  ipcMain.handle('printer:setName', (event, printerName) => {
    const name = String(printerName || '').trim();
    if (name) db.setSetting('printerName', name);
  });
  ipcMain.handle('printer:test', async (event, printerName) => {
    const name = String(printerName || '').trim();
    if (!name) return { error: 'Enter a printer name.' };
    try {
      const { confirmed, paperLow } = await printTestReceipt(name);
      const message = confirmed
        ? 'Test receipt printed.'
        : "Test receipt sent to the print queue. This printer can't confirm that it printed.";
      return { message: paperLow ? `${message} ${PAPER_LOW}` : message };
    } catch (err) {
      return { error: err.message };
    }
  });
  const unpackagedError = () => app.isPackaged ? null : { error: 'Updates only work in the installed app.' };

  ipcMain.handle('updates:check', async () => {
    const err = unpackagedError();
    if (err) return err;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) return { message: `Bluewater Kiosk is up to date (version ${app.getVersion()}).` };
      return { available: result.updateInfo.version };
    } catch {
      return { error: "Couldn't check for updates. Check the internet connection and try again." };
    }
  });
  // Downloads the update found by the last check, then quits, installs it, and reopens the app.
  ipcMain.handle('updates:install', async () => {
    const err = unpackagedError();
    if (err) return err;
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      return { error: "Couldn't download the update. Check the internet connection and try again." };
    }
    autoUpdater.quitAndInstall(true, true);
    return {};
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (db) db.close();
});
