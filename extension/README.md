# Work Hours Tracker

A Chrome and Edge extension for tracking GitLab work hours, managing leave, and exporting monthly work reports.

## Features

- Daily, weekly, and monthly totals with separate work and leave hours.
- Monthly calendar, searchable timelogs, task links, and daily notes.
- Daily note notifications at a configurable time (10:00 in the system timezone by default).
- Local leave tracking with JSON backup and restore for leave, manual work, daily notes and settings.
- Direct Excel export with KPI formulas, plus CSV export for the [Python CLI](../README.md).
- Compact popup and full-tab dashboard, with automatic sync every 30 minutes and manual refresh.
- Monthly time allocation by project, with hours, percentages, and links to filtered timelogs.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory containing `manifest.json`.
4. Pin the extension and open it to complete setup.

No build step, npm installation, or Python server is required to use the extension. Chrome 120+ or a compatible Chromium-based Edge version is required.

Supports **GitLab 18** with a personal access token scoped to `read_api`.

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
- Timelog cards show the current GitLab task state (Open/Closed, or Merged/Locked for merge requests). These values refresh on sync; click **Sync** after updating the extension to populate them for cached timelogs. In **Report & Export**, click **Load task summary** to group monthly tasks/MRs using the Excel data, with monthly Spent, whole-task Estimate and Spent / Estimate. Values above 100% are highlighted; missing estimates show —. Reload the summary after syncing or changing months.
- Click **Export Excel** to download the selected month's report. Work items with an exact `UNPLANNED` label (case-insensitive) are classified as `Phát sinh`; other tasks and all merge requests remain `Kế hoạch`. The original Excel template, Vietnamese report labels, and KPI formulas are preserved.
- Use **Export CSV** to download `tasks_MM_YYYY.csv`. For the CLI workflow, place it in the repository's `input/` directory and run `uv run report -m 10 -y 2026` with the appropriate month and year. The Python CLI detects paths from automatically named projects in this CSV; custom project names require matching entries in `projects.json`. Manual work and OFF entries need no project mapping. Direct Excel export needs no project file.
- Open settings to update the connection, projects, or Excel filename pattern (`MM` and `YYYY` placeholders).

**Time allocation** in **Report & Export** shows monthly work hours by project, sorted from most to least, including manual work under **Nghiên cứu**. Leave is excluded. Click a row to view that group's timelogs for the full selected month; choose another project or **All projects** in Timelog to change the filter. The chart uses synced timelogs without additional GitLab requests and updates after sync, month changes, or manual work edits. Duplicate project names include their paths. Failed syncs display a warning beside available data. If a group has a negative net total from time corrections, all groups show hours without bars or percentages.

Only the token owner's timelogs are counted, across all detected projects unless an optional project filter is set. Existing project lists remain active; clear the filter in Settings and save to switch to automatic detection. Dates and reminder schedules use the browser/system timezone, including daylight saving changes; weeks start on Monday and include only days within the selected month. Dashboard targets are 8 hours per day, 40 per week, and 192 per month, including leave. Excel summarizes leave only in the scoring sheet explanation and excludes it from task statistics.

Sync may be delayed while the browser is closed or the device is asleep. A failed sync preserves cached data and displays an error; exports require a successful sync.

## Work outside GitLab

In **Timelog**, expand **Add work outside GitLab** and enter a date, work name, and hours (greater than 0, up to 24 per entry). Entries have no project, category, estimate, or GitLab status. Use **Edit** / **Delete** on each manual entry to maintain it. They are stored locally per GitLab account/server and can be edited without a token or network connection after setup.

Manual hours count as work in the daily/weekly/monthly totals and Spent/192h. Monthly reports and direct Excel exports combine entries with the same name into one row under **Nghiên cứu**, summing only that month's hours. Names are trimmed and Unicode-normalized; letter case is preserved. Estimates stay blank. In Excel, these rows count as planned work; leave appears only in the scoring sheet explanation. Manual entries are included in the existing JSON backup/restore alongside leave; old leave-only backups still work. Refresh the monthly task summary after edits.

## Note reminders

In **Settings**, enable **Daily note reminders** and choose a **Reminder time** (system timezone). Reminders are enabled by default at 10:00. Only saved, nonempty notes for today and the connected account trigger a notification, once per day per account. Click the notification to open that day's note.

The browser must be running and notifications must be allowed in your operating system. Delivery can be delayed while the device sleeps; the extension catches up for the current day when it resumes. Saving a note after the scheduled time also triggers a reminder if none has been sent that day. Changing the time or editing a note does not send a second reminder that day.

Notes are local, so reminders work offline and after a session token expires. Disconnecting the account or disabling reminders stops future reminders. Long notes may be truncated by the notification display; open the note to read it in full.

After updating an unpacked installation, reload the extension at `chrome://extensions` or `edge://extensions` to apply the new `notifications` permission.

## Missing-hours reminders

With GitLab and Odoo connected, the extension automatically checks **today's** hours at the evening checkout time configured in **Settings → Odoo Attendance**, Monday–Friday in the system timezone. It refreshes GitLab timelogs and compares the day's GitLab work, manual work and leave against the dashboard's **8-hour** target, rounded to minutes. The optional GitLab project filter also applies here. If the total is short, a notification shows the total and remaining hours; click it to open that day's details.

The check runs independently of Odoo attendance reminders and does not require an actual Odoo checkout or a successful Odoo attendance read. Each GitLab account is checked successfully at most once per day, including when the target is met. Browser restarts do not repeat a completed check. If the browser resumes after checkout, only today is checked; missed days are not replayed. Missing tokens or failed syncs never trigger a shortage notification and are retried during the regular 30-minute GitLab sync. Notifications must be allowed. Disconnecting GitLab or Odoo stops this reminder.

## Data and privacy

Settings, cached timelogs, manual work, leave, and notes stay in local extension storage. Tokens are session-only by default; **Remember token** stores the token locally across browser sessions, without encryption or Chrome account sync.

Manual work, leave and notes are separated by GitLab account and server. Use **Settings → General → Backup and restore** to export or import JSON backups. JSON backups include all months of leave, manual work and daily notes for the connected account, plus project filters, the Excel filename pattern, language, note reminder settings, the remember-token preference and Odoo connection/reminder settings. Tokens, cached GitLab data and Odoo attendance data are excluded. Notes remain excluded from Excel reports.

Connect to the same GitLab account and server before restoring. Restore merges missing entries, skips identical entries and rejects the entire import if entries conflict or the file is invalid. Settings present in the backup replace current settings. Old leave/work-only backups still work and preserve current notes and settings. On a new browser profile, reconnect Odoo to grant server access. Backups never include a token; restoring the remember-token preference only changes where the current browser's existing token is stored.

Back up leave before removing the extension or changing browser profiles. Uninstalling removes local data; original timelogs remain on GitLab.

## Odoo attendance (version 17)

The **Odoo · Attendance today** card reads attendance using your existing Odoo login in the same browser profile. Open **Settings** and select the **Odoo Attendance** tab (or click the settings icon on the Odoo card), enter your Odoo server URL (for example, `https://odoo.example.com`), then click **Save & Connect** and allow access to that server. The URL is saved only in your local extension settings; no company address is bundled in the source. No password, API key, or cookie value is stored by the extension. By default, it only reads `/hr_attendance/attendance_user_data`.

The card displays today's attendance hours reported by Odoo as hours and minutes, rounded to the nearest minute (for example, `4.75` hours displays as `4h 45m`), including the ongoing check-in session up to the last refresh. The number updates on sync rather than ticking live; missing hours or failed requests display `—`. Odoo determines the day using the employee's timezone.

Reminders use the system timezone, Monday–Friday. Times are editable and reminders can be disabled. Attendance syncs every **30 minutes** and when the dashboard opens. Each milestone also has a **30-minute reminder window**, with checks at its start, +10, +20 and +30 minutes (for example, 08:30, 08:40, 08:50 and 09:00). The final minute is included to tolerate small alarm or network delays; the example window closes at 09:01. Missing attendance triggers a notification on each check, at most once per 10-minute interval. Once attendance is complete, that milestone's reminders stop for the day. Click a notification to open Odoo. After sleep, expired windows are skipped and only the current interval can notify; earlier checks are not replayed. Afternoon check-in must be a new check-in after the lunch check-out reminder time.

Expired sessions, missing permissions and connection failures show an unknown/error state and do not generate attendance reminders. Browser cookie settings or company customizations may prevent session access; the connection must be verified in your logged-in browser. Attendance is independent of GitLab timelogs, notes, leave entries and report exports. **Disconnect Odoo** stops its checks and reminders.

## Development

Source files are in `src/`; the Excel template and bundled ExcelJS library are included in the extension.

Run the tests with Node.js 20+:

```bash
cd extension
npm test
```

## KPI scoring sheet

Excel exports also include **Chấm điểm KPI**, matching the second sheet in `example.xlsx`. Its seven metrics link to the work report and its scores follow the printed thresholds and weights. Excel recalculates the scores when opened and after you edit report values. Reports without tasks leave the metrics and scores blank. The explanation field lists the selected month's leave, grouped by reason with total hours and dates (for example, `1. Nghỉ lễ 16h (02/09, 03/09)`). Without leave, it remains blank. Self-assessment fields are left empty for you to complete.
