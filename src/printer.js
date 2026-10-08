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
  winspool = {
    OpenPrinterW: lib.func('bool __stdcall OpenPrinterW(str16 pPrinterName, _Out_ HANDLE *phPrinter, void *pDefault)'),
    StartDocPrinterW: lib.func('uint32_t __stdcall StartDocPrinterW(HANDLE hPrinter, uint32_t Level, DOC_INFO_1W *pDocInfo)'),
    StartPagePrinter: lib.func('bool __stdcall StartPagePrinter(HANDLE hPrinter)'),
    WritePrinter: lib.func('bool __stdcall WritePrinter(HANDLE hPrinter, void *pBuf, uint32_t cbBuf, _Out_ uint32_t *pcWritten)'),
    EndPagePrinter: lib.func('bool __stdcall EndPagePrinter(HANDLE hPrinter)'),
    EndDocPrinter: lib.func('bool __stdcall EndDocPrinter(HANDLE hPrinter)'),
    ClosePrinter: lib.func('bool __stdcall ClosePrinter(HANDLE hPrinter)'),
  };
  return winspool;
}

async function sendRawWindows(printerName, data) {
  const w = await loadWinspool();
  const out = [null];
  if (!w.OpenPrinterW(printerName, out, null)) {
    throw new Error(`Could not open printer "${printerName}". Check the name in Printers & scanners.`);
  }
  const handle = out[0];
  try {
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
