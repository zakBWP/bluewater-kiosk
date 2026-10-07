import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { openDatabase, COMMAND_TYPES } from './src/db.js';
import { DEFAULT_PRINTER_NAME, printTestReceipt } from './src/printer.js';

let db;

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
    currentYear: new Date().getFullYear(),
  }));
  ipcMain.handle('jobs:list', () => db.listJobs());
  ipcMain.handle('jobs:create', (event, input) => ({ error: db.createJob(input) }));
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
