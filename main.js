import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { openDatabase } from './src/db.js';
import { COMMAND_TYPES, COMMAND_STRUCTURES } from './src/command-types.js';
import { PAY_GRADES, rateLabelFor } from './src/entry-options.js';
import { DEFAULT_PRINTER_NAME, printEntryTicket, printTestReceipt } from './src/printer.js';

let db;

const PAPER_LOW = 'The printer paper is running low. Load a new roll soon.';
const UNPRINTED = 'unprintedEntry'; // setting: uuid of the entry whose ticket failed to print

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
    const { paperLow } = await printEntryTicket(db.getSetting('printerName', DEFAULT_PRINTER_NAME), {
      job,
      entry,
      rateLabel: rateLabelFor(job.commandType),
    });
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
  db = openDatabase(process.env.DB_PATH || path.join(app.getPath('userData'), 'jobs.db'));

  ipcMain.handle('app:info', () => ({
    commandTypes: COMMAND_TYPES,
    commandStructures: COMMAND_STRUCTURES,
    payGrades: PAY_GRADES,
    currentYear: new Date().getFullYear(),
  }));
  ipcMain.handle('jobs:rateLabel', (event, commandType) => rateLabelFor(commandType));
  ipcMain.handle('jobs:list', () => db.listJobs());
  ipcMain.handle('jobs:get', (event, id) => db.getJob(id));
  ipcMain.handle('jobs:create', (event, input) => ({ error: db.createJob(input) }));
  ipcMain.handle('jobs:update', (event, id, input) => ({ error: db.updateJob(id, input) }));
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
  ipcMain.handle('entries:count', (event, jobId) => db.countEntries(jobId));
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
    db.setSetting('printerName', name);
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
