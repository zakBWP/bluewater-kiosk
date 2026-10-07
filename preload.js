const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  createJob: (job) => ipcRenderer.invoke('jobs:create', job),
  getPrinterName: () => ipcRenderer.invoke('printer:getName'),
  printTest: (printerName) => ipcRenderer.invoke('printer:test', printerName),
});
