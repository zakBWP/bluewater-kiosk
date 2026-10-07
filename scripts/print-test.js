// Prints a test receipt to an ESC/POS printer through the macOS print system (CUPS).
// Usage: node scripts/print-test.js [printer-name]   (default: EPSON_TM_m10)
const { spawnSync } = require('child_process');

const PRINTER = process.argv[2] || 'EPSON_TM_m10';

const ESC = 0x1b;
const GS = 0x1d;

const init = () => Buffer.from([ESC, 0x40]);
const align = (n) => Buffer.from([ESC, 0x61, n]); // 0 left, 1 center, 2 right
const bold = (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
const size = (w, h) => Buffer.from([GS, 0x21, ((w - 1) << 4) | (h - 1)]); // 1-8x each way
const text = (s) => Buffer.from(s + '\n', 'ascii');
const feed = (lines) => Buffer.from([ESC, 0x64, lines]);
const cut = () => Buffer.from([GS, 0x56, 66, 0]); // feed to the cutter, then partial cut

// QR code (model 2) via GS ( k: set model, module size, error correction, store data, print.
function qr(data, moduleSize = 6) {
  const bytes = Buffer.from(data, 'ascii');
  const len = bytes.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00]),
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize]),
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31]), // error correction level M
    Buffer.from([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]),
    bytes,
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]),
  ]);
}

const now = new Date();
const receipt = Buffer.concat([
  init(),
  align(1),
  size(2, 2), bold(true), text('TEST RECEIPT'), bold(false), size(1, 1),
  text(now.toLocaleString()),
  feed(1),
  align(0),
  text('Job:      Test Job'),
  text('Command:  CVN (Ford-class)'),
  text('Year:     ' + now.getFullYear()),
  text('Parts:    4'),
  text('--------------------------------'),
  bold(true), text('Bold text'), bold(false),
  feed(1),
  align(1),
  qr('testapp:job:test'),
  text('testapp:job:test'),
  cut(),
]);

const result = spawnSync('lp', ['-d', PRINTER, '-o', 'raw'], { input: receipt, encoding: 'utf8' });
if (result.error || result.status !== 0) {
  console.error((result.error && result.error.message) || result.stderr.trim());
  process.exit(1);
}
console.log(result.stdout.trim());
