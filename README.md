# Work Report Generator

Generate monthly work reports from GitLab work items, merge requests and manual work. Use the [Chrome / Edge extension](extension/README.md) to track hours and export reports directly, or use the Python CLI with a monthly task CSV.

## Features

- Fetch task dates and estimates from GitLab.
- Generate CSV and Excel reports with project sections, task links, and KPI formulas.
- Group manual work under **Nghiên cứu** and summarize leave in the scoring explanation.
- Track daily, weekly, and monthly hours through the standalone browser extension.

## CLI setup

Requires Python 3.12+. Reports containing GitLab tasks/MRs also require a personal access token with the `read_api` scope; manual-work/leave-only reports can run offline.

Install dependencies from the repository root:

```bash
uv sync
```

Alternatively, install with `pip install -e .` and use `report` instead of `uv run report`.

Create a `.env` file:

```dotenv
GITLAB_URL=https://gitlab.example.com
GITLAB_TOKEN=your_gitlab_token
```

For custom project names, copy the optional project configuration and update its names and GitLab paths. CSV exports using `Project name (group/path)` or a full GitLab project path are detected automatically, so these exports need no `projects.json`:

```bash
cp projects.json.example projects.json
```

```json
[
  {"project": "Project A", "url": "group/project-a"},
  {"project": "OFF", "url": ""}
]
```

## Input

Place a CSV named `tasks_MM_YYYY.csv` in `input/`, either exported from the extension or created manually:

```csv
Project,Task,Type,Time,Date
Project A,1573,TASK,5,"October 1, 2026"
Project A,102,MR,2.5,"October 2, 2026"
Nghiên cứu,Internal research,MANUAL,2,"October 3, 2026"
OFF,Annual Leave,OFF,8,"October 5, 2026"
```

| Column | Value |
| --- | --- |
| `Project` | Name from `projects.json`, an automatically detected `Name (group/path)`, `Nghiên cứu` for manual work, or `OFF` for leave |
| `Task` | Work item / merge request ID, manual work name, or a leave description |
| `Type` | `TASK`, `MR`, `MANUAL`, or `OFF` |
| `Time` | Hours worked or taken as leave; decimals are supported |
| `Date` | English date in `Month Day, Year` format |

## Usage

```bash
uv run report -m 10 -y 2026
uv run report -m 10 -y 2026 --excel-pattern "Report - KPI (MM-YYYY)"
uv run report --help
```

Reports include only the selected month and are written to `output/YYYY/MM/`:

- `report_MM_YYYY.csv`: enriched task data, excluding leave.
- `report_MM_YYYY.xlsx`: formatted work report with project tables, task statistics, and KPI formulas. Leave appears only in **Giải trình** on **Chấm điểm KPI**, grouped by reason with total hours and dates. The work sheet has no OFF section.

The Excel filename pattern can also be set with `EXCEL_PATTERN` in `.env`. `MM` and `YYYY` are replaced with the reporting month and year; invalid filename characters such as `/` become `_`, matching extension downloads. CSV filenames stay `report_MM_YYYY.csv`.

Manual entries with the same name are combined within the reporting month, with blank estimates and no GitLab requests. The **Nghiên cứu** group follows GitLab projects. Manual work counts as planned work in task statistics. Displayed project names omit `(project_path)` while project paths are retained internally for correct GitLab links and separate groups for projects with identical names.

The CLI uses the bundled template at `src/kpi_report/templates/work_report.xlsx`; `example.xlsx` is not required. The CLI and extension templates have matching labels, formulas and layout, including the compact statistics/ratio tables and the gap between them. Excel report labels remain Vietnamese. CSV dates are calendar dates and are preserved as exported; the extension assigns GitLab timelogs to dates using the system timezone. Tasks with an exact `UNPLANNED` label (case-insensitive) are classified as `Phát sinh`; other tasks and all merge requests are `Kế hoạch`. The company working-time target remains 192 hours, and formulas recalculate when the workbook is opened.

For browser installation, direct Excel export, local storage, and extension tests, see the [extension README](extension/README.md).

## KPI scoring sheet

Excel exports also include **Chấm điểm KPI**, matching the second sheet in `example.xlsx`. Its seven metrics link to the work report and its scores follow the printed thresholds and weights. Excel recalculates the scores when opened and after you edit report values. Reports without tasks leave the metrics and scores blank. The explanation field is filled from monthly leave, for example `1. Nghỉ lễ 16h (02/09, 03/09)`; it remains blank without leave. Self-assessment fields remain empty for you to complete.

## Development checks

```bash
uv run python -m unittest discover -s tests
npm test --prefix extension
```

The CLI tests include a comparison against an extension-generated Excel workbook using the same GitLab tasks, manual work and leave. Node.js is required for that comparison. The check also ensures both bundled templates are identical.
