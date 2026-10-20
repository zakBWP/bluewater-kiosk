import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import thermalPrinter from 'node-thermal-printer';
import QRCode from 'qrcode';
import { printUsb } from './usb-printer.js';

const { ThermalPrinter, PrinterTypes } = thermalPrinter;

export const DEFAULT_PRINTER_NAME = process.platform === 'win32' ? 'EPSON TM-m10 Receipt5' : 'EPSON_TM_m10';

// The serial number of a CUPS queue's USB printer, from its device URI
// (usb://EPSON/TM-m10?serial=...), or null if it isn't connected by USB.
async function cupsUsbSerial(printerName) {
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)('lpstat', ['-v', printerName]));
  } catch {
    throw new Error(`There's no printer called "${printerName}". Choose one in Settings.`);
  }
  const uri = stdout.slice(stdout.indexOf(':') + 1).trim();
  if (!uri.startsWith('usb://')) return null;
  return new URL(uri).searchParams.get('serial');
}

// macOS/Linux: hand the bytes to CUPS as a raw job, so the driver passes them through untouched.
function sendRawCups(printerName, data) {
  return new Promise((resolve, reject) => {
    const lp = spawn('lp', ['-d', printerName, '-o', 'raw']);
    let stdout = '';
    let stderr = '';
    lp.stdout.on('data', (d) => { stdout += d; });
    lp.stderr.on('data', (d) => { stderr += d; });
    lp.on('error', reject);
    lp.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `lp exited with code ${code}`));
    });
    lp.stdin.end(data);
  });
}

// Windows: send the bytes to the print queue as a RAW job through the spooler (winspool.drv),
// which the Epson Advanced Printer Driver passes straight to the printer.
let winspool;
async function loadWinspool() {
  if (winspool) return winspool;
  const { default: koffi } = await import('koffi');
  const lib = koffi.load('winspool.drv');
  koffi.pointer('HANDLE', koffi.opaque());
  koffi.struct('DOC_INFO_1W', { pDocName: 'str16', pOutputFile: 'str16', pDatatype: 'str16' });
  koffi.struct('PRINTER_INFO_2W', {
    pServerName: 'str16', pPrinterName: 'str16', pShareName: 'str16', pPortName: 'str16',
    pDriverName: 'str16', pComment: 'str16', pLocation: 'str16', pDevMode: 'void *',
    pSepFile: 'str16', pPrintProcessor: 'str16', pDatatype: 'str16', pParameters: 'str16',
    pSecurityDescriptor: 'void *', Attributes: 'uint32_t', Priority: 'uint32_t',
    DefaultPriority: 'uint32_t', StartTime: 'uint32_t', UntilTime: 'uint32_t', Status: 'uint32_t',
    cJobs: 'uint32_t', AveragePPM: 'uint32_t',
  });
  koffi.struct('SYSTEMTIME', {
    wYear: 'uint16_t', wMonth: 'uint16_t', wDayOfWeek: 'uint16_t', wDay: 'uint16_t',
    wHour: 'uint16_t', wMinute: 'uint16_t', wSecond: 'uint16_t', wMilliseconds: 'uint16_t',
  });
  koffi.struct('JOB_INFO_1W', {
    JobId: 'uint32_t', pPrinterName: 'str16', pMachineName: 'str16', pUserName: 'str16',
    pDocument: 'str16', pDatatype: 'str16', pStatus: 'str16', Status: 'uint32_t', Priority: 'uint32_t',
    Position: 'uint32_t', TotalPages: 'uint32_t', PagesPrinted: 'uint32_t', Submitted: 'SYSTEMTIME',
  });
  winspool = {
    koffi,
    OpenPrinterW: lib.func('bool __stdcall OpenPrinterW(str16 pPrinterName, _Out_ HANDLE *phPrinter, void *pDefault)'),
    GetPrinterW: lib.func('bool __stdcall GetPrinterW(HANDLE hPrinter, uint32_t Level, void *pPrinter, uint32_t cbBuf, _Out_ uint32_t *pcbNeeded)'),
    GetJobW: lib.func('bool __stdcall GetJobW(HANDLE hPrinter, uint32_t JobId, uint32_t Level, void *pJob, uint32_t cbBuf, _Out_ uint32_t *pcbNeeded)'),
    SetJobW: lib.func('bool __stdcall SetJobW(HANDLE hPrinter, uint32_t JobId, uint32_t Level, void *pJob, uint32_t Command)'),
    StartDocPrinterW: lib.func('uint32_t __stdcall StartDocPrinterW(HANDLE hPrinter, uint32_t Level, DOC_INFO_1W *pDocInfo)'),
    StartPagePrinter: lib.func('bool __stdcall StartPagePrinter(HANDLE hPrinter)'),
    WritePrinter: lib.func('bool __stdcall WritePrinter(HANDLE hPrinter, void *pBuf, uint32_t cbBuf, _Out_ uint32_t *pcWritten)'),
    EndPagePrinter: lib.func('bool __stdcall EndPagePrinter(HANDLE hPrinter)'),
    EndDocPrinter: lib.func('bool __stdcall EndDocPrinter(HANDLE hPrinter)'),
    ClosePrinter: lib.func('bool __stdcall ClosePrinter(HANDLE hPrinter)'),
  };
  return winspool;
}

const PRINTER_OFF = 'The printer is off or unplugged.';
const JOB_TIMEOUT = 5000; // ms to wait for the spooler to hand a ticket to the printer
const JOB_POLL_INTERVAL = 250; // ms between job status checks

const PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x400;
const PRINTER_STATUS = [
  [0x00000010, 'The printer is out of paper. Load a new roll.'], // PAPER_OUT
  [0x00000008, 'The paper is jammed. Open the cover, clear the paper, and close it.'], // PAPER_JAM
  [0x00400000, 'The printer cover is open. Close it firmly.'], // DOOR_OPEN
  [0x00000080, PRINTER_OFF], // OFFLINE
  [0x00001000, PRINTER_OFF], // NOT_AVAILABLE
  [0x00000001, 'The print queue is paused. Resume it in Printers & scanners.'], // PAUSED
  [0x00100000, 'The printer needs attention. Check it, or turn it off and on again.'], // USER_INTERVENTION
  [0x00000002, 'The printer reported an error. Turn it off and on again.'], // ERROR
];
const JOB_STATUS_DONE = 0x80 | 0x1000; // PRINTED | COMPLETE, when the queue keeps printed jobs
const JOB_STATUS = [
  [0x40, 'The printer is out of paper. Load a new roll.'], // PAPEROUT
  [0x20, PRINTER_OFF], // OFFLINE
  [0x400, 'The printer needs attention. Check it, or turn it off and on again.'], // USER_INTERVENTION
  [0x2, PRINTER_OFF], // ERROR: usually the port couldn't reach the printer
  [0x1, 'The ticket is paused in the print queue.'], // PAUSED
];
const JOB_CONTROL_DELETE = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls a winspool Get* function that fills a buffer of the size it asks for, and decodes it
// as `type`. Returns null if there's nothing to get (such as a job that has left the queue).
function getInfo(w, type, call) {
  const needed = [0];
  call(null, 0, needed);
  if (!needed[0]) return null;
  const buf = Buffer.alloc(needed[0]);
  if (!call(buf, buf.length, needed)) return null;
  return w.koffi.decode(buf, type);
}

// Returns a sentence describing why the printer can't print, or null if the queue looks ready.
function windowsPrinterProblem(w, handle) {
  const info = getInfo(w, 'PRINTER_INFO_2W', (buf, size, needed) => w.GetPrinterW(handle, 2, buf, size, needed));
  if (!info) return null;
  if (info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) return PRINTER_OFF;
  return PRINTER_STATUS.find(([bit]) => info.Status & bit)?.[1] ?? null;
}

// Waits until the spooler has handed the job to the printer. The spooler accepts a job even
// when the printer is unplugged, so a job that stays queued or reports an error means the
// ticket didn't reach it.
async function waitForWindowsJob(w, handle, jobId) {
  const deadline = Date.now() + JOB_TIMEOUT;
  for (;;) {
    const job = getInfo(w, 'JOB_INFO_1W', (buf, size, needed) => w.GetJobW(handle, jobId, 1, buf, size, needed));
    if (!job || job.Status & JOB_STATUS_DONE) return;
    const problem = JOB_STATUS.find(([bit]) => job.Status & bit)?.[1] ?? windowsPrinterProblem(w, handle);
    if (problem) throw new Error(problem);
    if (Date.now() > deadline) throw new Error(`${PRINTER_OFF} The ticket didn't reach it.`);
    await sleep(JOB_POLL_INTERVAL);
  }
}

async function sendRawWindows(printerName, data) {
  const w = await loadWinspool();
  const out = [null];
  if (!w.OpenPrinterW(printerName, out, null)) {
    throw new Error(`Could not open printer "${printerName}". Check the name in Printers & scanners.`);
  }
  const handle = out[0];
  try {
    const before = windowsPrinterProblem(w, handle);
    if (before) throw new Error(before);

    const jobId = w.StartDocPrinterW(handle, 1, { pDocName: 'Receipt', pOutputFile: null, pDatatype: 'RAW' });
    if (!jobId) throw new Error('Could not start the print job.');
    try {
      if (!w.StartPagePrinter(handle)) throw new Error('Could not start the page.');
      const written = [0];
      const ok = w.WritePrinter(handle, data, data.length, written);
      w.EndPagePrinter(handle);
      if (!ok || written[0] !== data.length) {
        throw new Error(`Only ${written[0]} of ${data.length} bytes reached the printer.`);
      }
    } finally {
      w.EndDocPrinter(handle);
    }
    try {
      await waitForWindowsJob(w, handle, jobId);
    } catch (err) {
      // Drop the stuck ticket, so it doesn't print later once the printer is plugged back in.
      w.SetJobW(handle, jobId, 0, null, JOB_CONTROL_DELETE);
      throw err;
    }
    return `Print job ${jobId} sent`;
  } finally {
    w.ClosePrinter(handle);
  }
}

// Sends the bytes and resolves with { confirmed, paperLow }. `confirmed` is true when the
// printer itself reported finishing the ticket; otherwise we only know the print queue took it.
async function send(printerName, buffer) {
  if (process.platform === 'win32') {
    await sendRawWindows(printerName, buffer);
    return { confirmed: false, paperLow: false };
  }
  const serial = await cupsUsbSerial(printerName);
  if (serial) return { confirmed: true, ...(await printUsb(serial, buffer)) };
  await sendRawCups(printerName, buffer);
  return { confirmed: false, paperLow: false };
}

// Lets node-thermal-printer build the ESC/POS bytes while we choose how they're sent.
function rawInterface(printerName) {
  return {
    getPrinterName: () => printerName,
    isPrinterConnected: async () => true,
    execute: (buffer) => send(printerName, buffer),
  };
}

function createPrinter(printerName) {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: printerName ? rawInterface(printerName) : undefined,
    width: 32, // characters per line on 58 mm paper (TM-m10, font A)
  });
}

const GS = 0x1d;
const QR_SCALE = 12; // printer dots per QR square
const QR_MARGIN = 2; // blank squares above and below the code
const PRINT_WIDTH = 360; // printable dots across 58 mm paper on the TM-m10

// Prints `text` as a QR code, centered. The code is drawn here and sent as a raster image
// (GS v 0) rather than with the printer's own QR command, whose size the printer limits. The
// scale is reduced if the code would be wider than the paper.
function printQrCode(printer, text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const scale = Math.max(1, Math.min(QR_SCALE, Math.floor(PRINT_WIDTH / modules.size)));
  const width = modules.size * scale;
  const rowBytes = Math.ceil(width / 8);
  const height = (modules.size + 2 * QR_MARGIN) * scale;
  const image = Buffer.alloc(rowBytes * height); // one bit per dot, 1 = black

  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / scale) - QR_MARGIN;
    if (row < 0 || row >= modules.size) continue;
    for (let x = 0; x < width; x++) {
      if (modules.get(row, Math.floor(x / scale))) image[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  printer.append(Buffer.from([GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, height & 0xff, height >> 8]));
  printer.append(image);
}

// SQLite stores datetime('now') in UTC as "YYYY-MM-DD HH:MM:SS".
function localTime(sqliteUtc) {
  return new Date(sqliteUtc.replace(' ', 'T') + 'Z').toLocaleString();
}

// Adds the ticket for one entry to the printer's buffer. Empty optional fields are left out.
export function buildEntryTicket(printer, { job, entry }) {
  const field = (label, value) => {
    if (!value) return;
    printer.bold(true);
    printer.print(`${label}: `);
    printer.bold(false);
    printer.println(value);
  };

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(job.name);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(localTime(entry.createdAt));
  printer.alignLeft();
  printer.drawLine();

  field('Name', `${entry.rateRank} ${entry.firstName} ${entry.lastName} (${entry.payGrade})`);
  field('Department', entry.division ? `${entry.department} (${entry.division})` : entry.department);

  const stateZip = [entry.state, entry.zip].filter(Boolean).join(' ');
  field('Address', [entry.street, entry.city, stateZip].filter(Boolean).join(', '));
  field('Emails', [entry.primaryEmail, entry.secondaryEmail].filter(Boolean).join('; '));

  printer.alignCenter();
  if (entry.internalId) {
    printQrCode(printer, entry.internalId);
    printer.bold(true);
    printer.println(entry.internalId);
    printer.bold(false);
  }
  printer.cut();
}

export async function printEntryTicket(printerName, ticket) {
  const printer = createPrinter(printerName);
  buildEntryTicket(printer, ticket);
  return printer.execute();
}

// A ticket filled with made-up details, to check the printer and the ticket layout.
const TEST_TICKET = {
  job: { name: 'Test Print' },
  entry: {
    internalId: '1234567',
    rateRank: 'AO3',
    firstName: 'Jane',
    lastName: 'Doe',
    payGrade: 'E-4',
    department: 'Air',
    division: 'V-1',
    street: '123 Main St',
    city: 'Norfolk',
    state: 'VA',
    zip: '23511',
    primaryEmail: 'jane.doe@example.com',
    secondaryEmail: 'family@example.com',
  },
};

export async function printTestReceipt(printerName) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' '); // as SQLite stores it
  return printEntryTicket(printerName, { ...TEST_TICKET, entry: { ...TEST_TICKET.entry, createdAt: now } });
}
