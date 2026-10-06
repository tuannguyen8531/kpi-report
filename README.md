# KPI Report Generator

Generate monthly KPI reports from GitLab work items and merge requests. Use the [Chrome / Edge extension](extension/README.md) to track hours and export reports directly, or use the Python CLI with a monthly task CSV.

## Features

- Fetch task dates and estimates from GitLab.
- Generate CSV and Excel reports with project sections, task links, and KPI formulas.
- Record leave separately from task statistics.
- Track daily, weekly, and monthly hours through the standalone browser extension.

## CLI setup

Requires Python 3.12+ and a GitLab personal access token with the `read_api` scope.

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

Copy the project configuration and update its names and GitLab paths:

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
OFF,Annual Leave,OFF,8,"October 5, 2026"
```

| Column | Value |
| --- | --- |
| `Project` | Name from `projects.json`, or `OFF` for leave |
| `Task` | Work item / merge request ID, or a leave description |
| `Type` | `TASK`, `MR`, or `OFF` |
| `Time` | Hours worked or taken as leave; decimals are supported |
| `Date` | English date in `Month Day, Year` format |

## Usage

```bash
uv run report -m 10 -y 2026
uv run report --help
```

Reports are written to `output/`:

- `report_MM_YYYY.csv`: enriched task data, excluding leave.
- `report_MM_YYYY.xlsx`: formatted work report with project tables, task statistics, and KPI formulas. Leave appears in a separate section outside task statistics.

The CLI uses the bundled template at `src/kpi_report/templates/work_report.xlsx`; `example.xlsx` is not required. Excel report labels and default task values retain the original Vietnamese template. The company working-time target remains 192 hours, and formulas recalculate when the workbook is opened.

For browser installation, direct Excel export, local storage, and extension tests, see the [extension README](extension/README.md).
