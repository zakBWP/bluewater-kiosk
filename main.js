import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { openDatabase } from './src/db.js';
import { COMMAND_TYPES, COMMAND_STRUCTURES } from './src/command-types.js';
import { PAY_GRADES, rateLabelFor } from './src/entry-options.js';
import { DEFAULT_PRINTER_NAME, printEntryTicket, printTestReceipt } from './src/printer.js';

let db;

// Prints an entry's ticket on the chosen printer. Returns null, or an error message.
async function printTicket(entry) {
  const job = db.getJob(entry.jobId);
  try {
    await printEntryTicket(db.getSetting('printerName', DEFAULT_PRINTER_NAME), {
      job,
      entry,
      rateLabel: rateLabelFor(job.commandType),
    });
    return null;
  } catch (err) {
    return err.message;
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
    const { error, entry } = db.createEntry(jobId, input);
    if (error) return { error };
    return { entry, printError: await printTicket(entry) };
  });
  ipcMain.handle('entries:reprint', async (event, uuid) => {
    const entry = db.getEntry(uuid);
    if (!entry) return { printError: 'Entry not found.' };
    return { printError: await printTicket(entry) };
  });
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
      return { message: await printTestReceipt(name) };
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
