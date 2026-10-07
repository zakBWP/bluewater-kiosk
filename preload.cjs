const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  getJob: (id) => ipcRenderer.invoke('jobs:get', id),
  createJob: (job) => ipcRenderer.invoke('jobs:create', job),
  updateJob: (id, job) => ipcRenderer.invoke('jobs:update', id, job),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  getPrinterName: () => ipcRenderer.invoke('printer:getName'),
  setPrinterName: (printerName) => ipcRenderer.invoke('printer:setName', printerName),
  printTest: (printerName) => ipcRenderer.invoke('printer:test', printerName),
});
