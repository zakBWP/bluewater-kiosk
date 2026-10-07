const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { openDatabase, COMMAND_TYPES } = require('./src/db');
const { DEFAULT_PRINTER_NAME, printTestReceipt } = require('./src/printer');

let db;

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  db = openDatabase(process.env.DB_PATH || path.join(app.getPath('userData'), 'jobs.db'));

  ipcMain.handle('app:info', () => ({
    commandTypes: COMMAND_TYPES,
    currentYear: new Date().getFullYear(),
  }));
  ipcMain.handle('jobs:list', () => db.listJobs());
  ipcMain.handle('jobs:create', (event, input) => ({ error: db.createJob(input) }));
  ipcMain.handle('printer:getName', () => db.getSetting('printerName', DEFAULT_PRINTER_NAME));
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
