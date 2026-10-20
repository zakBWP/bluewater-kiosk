# Bluewater Kiosk

Bluewater Publishing data entry kiosk built with Electron. Sailors enter their details into a form,
each entry is saved locally and given the next Internal ID, and a ticket with that ID as a
QR code prints on an Epson TM-m10 receipt printer. It's built for Windows and also runs on macOS.

## How it works

- **Jobs.** Each job has a name, a year, a command type and a list of departments and
  divisions. The command type (CVN, DDG, LHD, The Basic School, …) supplies a starting list
  that you can then edit for the job. Jobs can be exported as a `.bwp` file and imported on
  another kiosk to run in parallel.

- **Internal IDs.** A job's IDs come from a Workflow subject export: a CSV with an
  `Internal ID` column. The IDs are split into the job's *parts*, one for each kiosk. When a
  kiosk opens a job, you choose its part, so two kiosks never hand out the same ID.
- **Entry form.** It collects department, division, name, rate/rank, pay grade, address and
  emails. Each entry is saved before its ticket prints, so a printer problem never loses an
  entry.
- **Tickets.** A ticket shows the job, the time, the person's details, and their Internal ID
  as a QR code. If a ticket doesn't print, the form stays locked until someone fixes the
  printer and presses *Reprint*, so the next person can't start while someone is still
  owed a ticket.
- **Job data.** *Download job data* on the Edit Job screen saves the job's entries as a
  CSV.
- **Kiosk password.** If one is set in Settings, leaving the entry form requires it.

## Printing

The default printer is `EPSON TM-m10 Receipt5` on Windows and `EPSON_TM_m10` on macOS. You
can choose a different one in Settings, and **Test Print** prints a sample ticket.

- **macOS, printer connected by USB:** the app talks to the printer directly. It checks for
  a missing printer, an open cover, an empty or low paper roll, a jammed cutter and similar
  problems, and waits until the ticket has finished printing.
- **Windows:** tickets go through the print queue as raw ESC/POS data, using the Epson
  Advanced Printer Driver. The app checks the queue's status and waits for the ticket to
  leave the queue. It can't confirm that the ticket actually printed. A ticket that gets
  stuck is cancelled, so it doesn't print later.

## Development

You need Node.js 24 and npm.

```sh
npm install     
npm run dev     # in a normal window, with the default menu and Developer Tools
npm start       # full-screen kiosk mode, as installed
```

To leave kiosk mode, use **Quit application** in Settings.

The database is `kiosk.db` in the app's user data folder:

- Windows: `%APPDATA%\Bluewater Kiosk`
- macOS: `~/Library/Application Support/Bluewater Kiosk`

To use another database file, set `DB_PATH`.

If Electron reports a `better-sqlite3` version mismatch, run `npm run rebuild`.

### Project layout

| Path | What's there |
| --- | --- |
| `main.js` | Electron main process: window, IPC handlers, password and updates |
| `preload.cjs` | The `window.api` bridge between the page and the main process |
| `renderer/` | The interface: `index.html`, `style.css`, and one module per screen in `views/` |
| `src/db.js` | SQLite schema, migrations and queries |
| `src/printer.js` | Ticket layout and sending to the printer on each platform |
| `src/usb-printer.js` | Direct USB printing with status checks (macOS) |
| `src/command-types.js` | Command types and their starting departments and divisions |
| `src/internal-ids.js` | Reading and checking the Internal ID CSV |
| `src/entries-csv.js` | The job data CSV export functionality |

Database changes are made by adding a step to the end of `MIGRATIONS` in `src/db.js`. Never
edit a step that has already shipped.

## Releases and updates

Pushing a version tag builds the Windows installer with GitHub Actions and publishes it to
this repo's releases:

```sh
npm version 1.4.0 --no-git-tag-version   # update package.json and package-lock.json
git commit -am "Bump version to 1.4.0"
git push
git tag v1.4.0 && git push origin v1.4.0
```

The tag has to match the version in `package.json`, or the build stops.

Kiosks never update on their own. In Settings, **Check for Updates** looks for a newer
release, and **Download and Restart** installs it. Updates only work in the installed app.

To build the installer locally, without publishing it, run `npm run dist:win`. The output
goes to `dist/`.

To install it on a Mac, run `npm run dist:mac` and drag `dist/mac-arm64/Bluewater Kiosk.app`
into Applications. The app is signed ad-hoc, so it runs on the Mac that built it, and it
doesn't update itself: rebuild and replace it to update.

## Workflow subject data basics

The **Online Code** of a subject is set automatically by Workflow since *Manually Set Online Codes* is unchecked in the job settings. Used by customers to log in or look up their personal gallery online.

The **Internal ID** is referring to the Internal ID Workflow assigns each subject as they are created. Each subject gets one upon creation and it CANNOT be changed.
This is what the sorting algorithm reads from the photo's EXIF data (or QR code) to match photos to subjects.

The **Subject ID** is for an alphanumeric identifier (not needed, mostly for customers). The most common use for this field is a Student or Employee ID. (Use Subject ID as the column header on the data file to auto-map).

The **Reference Number** is for additional information (not needed). (Use reference number or refID as the column header on the data file to auto-map).

