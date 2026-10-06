# KPI Tracker

A Chrome and Edge extension for tracking GitLab work hours, managing leave, and exporting monthly KPI reports.

## Features

- Daily, weekly, and monthly totals with separate work and leave hours.
- Monthly calendar, searchable timelogs, task links, and daily notes.
- Daily note notifications at a configurable time (10:00 Vietnam time by default).
- Local leave tracking with JSON backup and restore.
- Direct Excel export with KPI formulas, plus CSV export for the [Python CLI](../README.md).
- Compact popup and full-tab dashboard, with automatic sync every 30 minutes and manual refresh.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory containing `manifest.json`.
4. Pin the extension and open it to complete setup.

No build step, npm installation, or Python server is required to use the extension. Chrome 120+ or a compatible Chromium-based Edge version is required.

## Setup

Enter your GitLab server URL and a personal access token with the `read_api` scope. Projects are detected automatically from your timelogs; no project file is required. Names include the full GitLab path to distinguish projects with identical names.

Optionally, use **Project filter** to import a `projects.json` file or enter a list to limit tracking and assign custom report names:

```json
[
  {"project": "Project A", "url": "group/project-a"},
  {"project": "Project B", "url": "group/project-b"}
]
```

Click **Save & Connect** and allow access to your GitLab server when prompted. HTTPS is required except on localhost. The extension reads GitLab data without modifying it.

## Usage

- Select a date to view its month. Click a total or double-click a calendar day for details; save daily notes from the day dialog.
- Open **Leave** to add, edit, or delete time off. Each date supports one entry with up to 24 hours.
- Click **Export Excel** to download the selected month's report. Work items with an exact `UNPLANNED` label (case-insensitive) are classified as `Phát sinh`; other tasks and all merge requests remain `Kế hoạch`. The original Excel template, Vietnamese report labels, and KPI formulas are preserved.
- Use **Export CSV** to download `tasks_MM_YYYY.csv`. For the CLI workflow, place it in the repository's `input/` directory and run `uv run report -m 10 -y 2026` with the appropriate month and year. The Python CLI still requires `projects.json`; its project names must match the CSV `Project` values. Direct Excel export needs no project file.
- Open settings to update the connection, projects, or Excel filename pattern (`MM` and `YYYY` placeholders).

Only the token owner's timelogs are counted, across all detected projects unless an optional project filter is set. Existing project lists remain active; clear the filter in Settings and save to switch to automatic detection. Dates use `Asia/Ho_Chi_Minh` (UTC+7); weeks start on Monday and include only days within the selected month. Dashboard targets are 8 hours per day, 40 per week, and 192 per month, including leave. Excel lists leave separately and excludes it from task statistics.

Sync may be delayed while the browser is closed or the device is asleep. A failed sync preserves cached data and displays an error; exports require a successful sync.

## Note reminders

In **Settings**, enable **Daily note reminders** and choose a **Reminder time** (Vietnam, UTC+7). Reminders are enabled by default at 10:00. Only saved, nonempty notes for today and the connected account trigger a notification, once per day per account. Click the notification to open that day's note.

The browser must be running and notifications must be allowed in your operating system. Delivery can be delayed while the device sleeps; the extension catches up for the current day when it resumes. Saving a note after the scheduled time also triggers a reminder if none has been sent that day. Changing the time or editing a note does not send a second reminder that day.

Notes are local, so reminders work offline and after a session token expires. Disconnecting the account or disabling reminders stops future reminders. Long notes may be truncated by the notification display; open the note to read it in full.

After updating an unpacked installation, reload the extension at `chrome://extensions` or `edge://extensions` to apply the new `notifications` permission.

## Data and privacy

Settings, cached timelogs, leave, and notes stay in local extension storage. Tokens are session-only by default; **Remember token** stores the token locally across browser sessions, without encryption or Chrome account sync.

Leave and notes are separated by GitLab account and server. Leave backups contain no token and can only be restored to the matching account and server; conflicting entries reject the restore. Notes are excluded from backups and reports.

Back up leave before removing the extension or changing browser profiles. Uninstalling removes local data; original timelogs remain on GitLab.

## Development

Source files are in `src/`; the Excel template and bundled ExcelJS library are included in the extension.

Run the tests with Node.js 20+:

```bash
cd extension
npm ci
npm test
```

## KPI scoring sheet

Excel exports also include **Chấm điểm KPI**, matching the second sheet in `example.xlsx`. Its seven metrics link to the work report and its scores follow the printed thresholds and weights. Excel recalculates the scores when opened and after you edit report values. Reports without tasks leave the metrics and scores blank. Explanation and self-assessment fields are left empty for you to complete.
