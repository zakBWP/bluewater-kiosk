// Talks to an Epson ESC/POS printer directly over USB, so we can read its status back:
// check it's ready before printing, and wait until it has actually finished the ticket.
import { WebUSB } from 'usb';

const DLE = 0x10;
const EOT = 0x04;
const GS = 0x1d;

const PRINTER_CLASS = 7;
const READY_TIMEOUT = 2000; // ms to wait for a status reply
const FINISH_TIMEOUT = 20000; // ms to wait for a ticket to finish printing
const POLL_INTERVAL = 500; // ms between status checks while printing

// Real-time status (DLE EOT n). Replies are one byte shaped 0xx1xx10.
const STATUS_PRINTER = 1;
const STATUS_OFFLINE = 2;
const STATUS_ERROR = 3;
const STATUS_PAPER = 4;
const isStatusReply = (b) => (b & 0x93) === 0x12;

// "Transmit paper sensor status" (GS r 1) is not real-time: the printer answers it only
// after everything sent before it has been printed, so its reply (shaped 0xx0xx00)
// tells us the ticket is done.
const FINISHED_MARKER = [GS, 0x72, 1];
const isFinishedReply = (b) => (b & 0x93) === 0x00;

// Real-time "clear buffers" (DLE DC4 fn=8): drops the rest of a ticket that couldn't
// finish, so it doesn't print half a ticket later once the problem is fixed.
const CLEAR_BUFFERS = [DLE, 0x14, 0x08, 1, 3, 20, 1, 6, 2, 8];

const PRINTER_OFF = 'The printer is off or unplugged.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Explains why the chosen printer's serial number isn't on USB. A print queue belongs to one
// printer, so another printer plugged in in its place (even the same model) isn't used.
async function missingPrinterProblem(usb) {
  let others = [];
  try {
    others = (await usb.getDevices()).filter((d) => d.configurations.some((c) =>
      c.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === PRINTER_CLASS))));
  } catch { /* fall back to the usual message */ }
  if (!others.length) return PRINTER_OFF;
  const name = others[0].productName || 'printer';
  return `A different ${name} is plugged in than the one chosen in Settings. Add this printer in `
    + 'Printers & Scanners, then choose it in Settings.';
}

class UsbPrinter {
  constructor(device) {
    this.device = device;
    this.received = []; // reply bytes not yet consumed
  }

  static async open(serial) {
    const usb = new WebUSB({ allowAllDevices: true });
    const device = await usb.findDeviceBySerial(serial);
    if (!device) throw new Error(await missingPrinterProblem(usb));
    const printer = new UsbPrinter(device);
    try {
      await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      const iface = device.configuration.interfaces.find((i) => i.alternate.interfaceClass === PRINTER_CLASS);
      if (!iface) throw new Error('This USB device is not a printer.');
      await device.claimInterface(iface.interfaceNumber);
      printer.interfaceNumber = iface.interfaceNumber;
      printer.outEndpoint = iface.alternate.endpoints.find((e) => e.direction === 'out').endpointNumber;
      const inEndpoint = iface.alternate.endpoints.find((e) => e.direction === 'in');
      printer.inEndpoint = inEndpoint.endpointNumber;
      printer.packetSize = inEndpoint.packetSize;
    } catch (err) {
      await printer.close();
      if (err.message.includes('ACCESS') || err.message.includes('BUSY')) {
        throw new Error('The printer is busy with another print job. Try again in a moment.');
      }
      throw err;
    }
    return printer;
  }

  async close() {
    try {
      if (this.interfaceNumber !== undefined) await this.device.releaseInterface(this.interfaceNumber);
    } catch { /* closing anyway */ }
    try {
      await this.device.close();
    } catch { /* already closed */ }
  }

  write(bytes, message = 'The printer stopped accepting data.') {
    return withTimeout(this.device.transferOut(this.outEndpoint, Uint8Array.from(bytes)), FINISH_TIMEOUT, message);
  }

  // Reads whatever the printer has sent. USB printers answer an empty read while a reply isn't ready.
  async poll() {
    const result = await this.device.transferIn(this.inEndpoint, this.packetSize);
    const { buffer, byteOffset, byteLength } = result.data;
    this.received.push(...new Uint8Array(buffer, byteOffset, byteLength));
    return byteLength > 0;
  }

  // Waits for a reply byte matching `test`. Other replies stay queued for their own waiters,
  // since a status reply and the "finished" reply can arrive in either order.
  async waitFor(test, ms) {
    const deadline = Date.now() + ms;
    for (;;) {
      const index = this.received.findIndex(test);
      if (index >= 0) return this.received.splice(index, 1)[0];
      if (Date.now() > deadline) return null;
      if (!(await this.poll())) await sleep(5);
    }
  }

  // Replies left over from an earlier session would be mistaken for answers to our questions.
  async discardStaleReplies() {
    for (let i = 0; i < 20; i++) await this.poll();
    this.received = [];
  }

  async status(n) {
    await this.write([DLE, EOT, n]);
    const reply = await this.waitFor(isStatusReply, READY_TIMEOUT);
    if (reply === null) throw new Error("The printer isn't responding. Try turning it off and on again.");
    return reply;
  }

  // Returns a sentence describing why the printer can't print, or null if it's ready.
  async problem() {
    if (!(await this.status(STATUS_PRINTER) & 0x08)) return null; // online
    const offline = await this.status(STATUS_OFFLINE);
    if (offline & 0x04) return 'The printer cover is open. Close it firmly.';
    if (offline & 0x20) return 'The printer is out of paper. Load a new roll.';
    if (offline & 0x40) {
      const error = await this.status(STATUS_ERROR);
      if (error & 0x08) return 'The paper cutter is jammed. Open the cover, clear the paper, and close it.';
      if (error & 0x20) return 'The printer has a fault. Turn it off and on again.';
      if (error & 0x40) return 'The print head is too hot. Wait a minute for it to cool down.';
      return 'The printer reported an error. Open and close the cover, or turn it off and on again.';
    }
    if (offline & 0x08) return 'Someone is holding the paper feed button.';
    return 'The printer is offline.';
  }

  async paperLow() {
    return (await this.status(STATUS_PAPER) & 0x0c) !== 0;
  }

  async clearBuffers() {
    try {
      await withTimeout(this.device.transferOut(this.outEndpoint, Uint8Array.from(CLEAR_BUFFERS)), READY_TIMEOUT, '');
    } catch { /* best effort */ }
  }
}

// Prints `data` and resolves once the printer has finished it, with { paperLow }.
// Rejects with a message saying what went wrong, worded for whoever is at the kiosk.
export async function printUsb(serial, data) {
  const printer = await UsbPrinter.open(serial);
  try {
    await printer.discardStaleReplies();
    const before = await printer.problem();
    if (before) throw new Error(before);

    await printer.write([...data, ...FINISHED_MARKER]);

    const deadline = Date.now() + FINISH_TIMEOUT;
    while (Date.now() < deadline) {
      if (await printer.waitFor(isFinishedReply, POLL_INTERVAL) !== null) {
        return { paperLow: await printer.paperLow() };
      }
      const during = await printer.problem();
      if (during) {
        await printer.clearBuffers();
        throw new Error(`${during} The ticket didn't finish printing.`);
      }
    }
    await printer.clearBuffers();
    throw new Error("The printer didn't finish the ticket in time.");
  } catch (err) {
    // A failed USB transfer usually means the printer was switched off or unplugged mid-job.
    if (err.message.startsWith('LIBUSB_ERROR_NO_DEVICE') || err.message.includes('disconnected')) {
      throw new Error(PRINTER_OFF);
    }
    throw err;
  } finally {
    await printer.close();
  }
}
