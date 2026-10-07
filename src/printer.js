import { spawn } from 'node:child_process';
import thermalPrinter from 'node-thermal-printer';

const { ThermalPrinter, PrinterTypes } = thermalPrinter;

export const DEFAULT_PRINTER_NAME = process.platform === 'win32' ? 'EPSON TM-m10 Receipt5' : 'EPSON_TM_m10';

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

// Lets node-thermal-printer build the ESC/POS bytes while we choose how they're sent.
function rawInterface(printerName) {
  return {
    getPrinterName: () => printerName,
    isPrinterConnected: async () => true,
    execute: (buffer) => (process.platform === 'win32'
      ? sendRawWindows(printerName, buffer)
      : sendRawCups(printerName, buffer)),
  };
}

function createPrinter(printerName) {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: printerName ? rawInterface(printerName) : undefined,
    width: 32, // characters per line on 58 mm paper (TM-m10, font A)
  });
}

// SQLite stores datetime('now') in UTC as "YYYY-MM-DD HH:MM:SS".
function localTime(sqliteUtc) {
  return new Date(sqliteUtc.replace(' ', 'T') + 'Z').toLocaleString();
}

// Adds the ticket for one entry to the printer's buffer. Empty optional fields are left out.
export function buildEntryTicket(printer, { job, entry, rateLabel }) {
  const field = (label, value) => {
    if (!value) return;
    printer.bold(true);
    printer.println(label);
    printer.bold(false);
    printer.println(value);
  };

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(job.name);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(`${job.commandType} - ${job.year}`);
  printer.println(localTime(entry.createdAt));
  printer.alignLeft();
  printer.drawLine();

  field('Name', `${entry.firstName} ${entry.lastName}`);
  field(rateLabel, entry.rateRank);
  field('Pay grade', entry.payGrade);
  field('Department', entry.department);
  field('Division', entry.division);
  printer.drawLine();

  const cityLine = [entry.city, [entry.state, entry.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (entry.street || cityLine) {
    printer.bold(true);
    printer.println('Address');
    printer.bold(false);
    if (entry.street) printer.println(entry.street);
    if (cityLine) printer.println(cityLine);
  }
  field('Primary email', entry.primaryEmail);
  field('Secondary email', entry.secondaryEmail);
  if (entry.street || cityLine || entry.primaryEmail || entry.secondaryEmail) printer.drawLine();

  printer.alignCenter();
  printer.println(`Entry ${entry.uuid.slice(0, 8).toUpperCase()}`);
  printer.cut();
}

export async function printEntryTicket(printerName, ticket) {
  const printer = createPrinter(printerName);
  buildEntryTicket(printer, ticket);
  return printer.execute();
}

export async function printTestReceipt(printerName) {
  const printer = createPrinter(printerName);

  const now = new Date();
  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.setTextDoubleWidth();
  printer.bold(true);
  printer.println('TEST RECEIPT');
  printer.bold(false);
  printer.setTextNormal();
  printer.println(now.toLocaleString());
  printer.newLine();
  printer.alignLeft();
  printer.leftRight('Printer:', printerName);
  printer.leftRight('Platform:', process.platform);
  printer.drawLine();
  printer.bold(true);
  printer.println('Bold text');
  printer.bold(false);
  printer.newLine();
  printer.alignCenter();
  printer.printQR('bluewater-kiosk:print-test', { cellSize: 6 });
  printer.println('bluewater-kiosk:print-test');
  printer.cut();

  return printer.execute();
}
