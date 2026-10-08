const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  getJob: (id) => ipcRenderer.invoke('jobs:get', id),
  createJob: (job) => ipcRenderer.invoke('jobs:create', job),
  updateJob: (id, job) => ipcRenderer.invoke('jobs:update', id, job),
  rateLabel: (commandType) => ipcRenderer.invoke('jobs:rateLabel', commandType),
  createEntry: (jobId, entry) => ipcRenderer.invoke('entries:create', jobId, entry),
  reprintEntry: (uuid) => ipcRenderer.invoke('entries:reprint', uuid),
  unprintedEntry: () => ipcRenderer.invoke('entries:unprinted'),
  countEntries: (jobId) => ipcRenderer.invoke('entries:count', jobId),
  isPasswordSet: () => ipcRenderer.invoke('password:isSet'),
  checkPassword: (password) => ipcRenderer.invoke('password:check', password),
  setPassword: (password) => ipcRenderer.invoke('password:set', password),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  getPrinterName: () => ipcRenderer.invoke('printer:getName'),
  setPrinterName: (printerName) => ipcRenderer.invoke('printer:setName', printerName),
  printTest: (printerName) => ipcRenderer.invoke('printer:test', printerName),
});
