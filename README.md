# KPI Report Generator

A CLI tool for generating KPI reports from GitLab data.

## Features

- Fetch work item and merge request data from GitLab API
- Generate CSV reports and Excel work reports with KPI formulas
- Progress tracking during data processing  
- Support for multiple projects configuration
- Automatic project headers in output files

## Installation

### Using uv (recommended)

```bash
# Clone repository
git clone <repository-url>
cd kpi-report

# Install with uv
uv sync

# Run the tool
uv run report -m 9 -y 2025
```

### Manual installation

```bash
pip install -e .
report -m 9 -y 2025
```

## Configuration

### 1. Environment Variables

Create a `.env` file:

```
GITLAB_URL=https://gitlab.example.com
GITLAB_TOKEN=your_gitlab_token_here
```

### 2. Project Configuration

Create a `projects.json` file from the example:

```bash
cp projects.json.example projects.json
```

Then edit `projects.json` with your GitLab project paths:

```json
[
    {
        "project": "ProjectName1",
        "url": "gitlab/full/path/to/project1"
    },
    {
        "project": "ProjectName2",
        "url": "gitlab/full/path/to/project2"
    },
    {
        "project": "OFF",
        "url": ""
    }
]
```

### 3. Input Data

Place your CSV files in the `input/` directory with the naming pattern:
`tasks_MM_YYYY.csv`

Example: `input/tasks_09_2025.csv`

#### Input File Structure

The input CSV file must contain the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| `Project` | Project name (must match `projects.json`) or "OFF" for time off | `D-System`, `VILD-Gacha`, `OFF` |
| `Task` | Task/MR ID number, or description for OFF entries | `1573`, `401`, `Annual Leave` |
| `Type` | Type of task | `TASK`, `MR`, `OFF` |
| `Time` | Hours spent on the task | `8`, `4.5`, `3` |
| `Date` | Date of work | `November 3, 2025` |

**Example CSV content:**

```csv
Project,Task,Type,Time,Date
OFF,Annual Leave,OFF,8,"November 7, 2025"
D-System,1573,TASK,5,"November 3, 2025"
D-System,1615,TASK,8,"November 4, 2025"
VILD-Gacha,393,TASK,1,"November 12, 2025"
D-System,102,MR,2.5,"November 18, 2025"
```

**Important Notes:**
- Date format must be: `Month Day, Year` (e.g., `November 3, 2025`)
- Project names must match entries in `projects.json`
- OFF entries appear in a separate section in Excel, outside the task statistics.
  They are excluded from the CSV export.
- For TASK type: The tool will fetch additional data from GitLab (start date, due date, closed date, estimate)
- For MR type: The tool will fetch estimate from GitLab merge request
- Time can be decimal values (e.g., `4.5` for 4.5 hours)

## Usage

For live day/week/month tracking and easy leave entry, install the standalone
[Chrome/Edge extension](extension/README.md). It stores data locally, syncs
GitLab every five minutes, supports manual sync, and exports the monthly CSV
used by the command below. Its source lives in `extension/src/`, separately
from the Python application.

```bash
# Generate report for September 2025
uv run report -m 9 -y 2025

# Or using short options
uv run report --month 9 --year 2025

# Show help
uv run report --help
```

## Output

The tool generates two files in the `output/` directory:

- `report_MM_YYYY.csv` - CSV format with decimal points
- `report_MM_YYYY.xlsx` - Sheet `Báo cáo công việc`, matching the layout and
  styling of `example.xlsx`: project tables on the left, task statistics and
  percentage formulas on the right. Dates and hours are native Excel values.
  OFF entries appear below the project tables and are excluded from task
  statistics. Company working time stays at 192 hours
  as specified by the example. Excel recalculates formulas when opened.

The clean template is bundled at `src/kpi_report/templates/work_report.xlsx`;
the original `example.xlsx` is not required to run the tool. Task type and
progress still default to `Kế hoạch` and `Đúng hạn`; editing them or the reopen
count in Excel updates the statistics. Empty denominators produce 0 instead
of a division error. Only the requested work-report sheet is exported.

## Project Structure

```
kpi-report/
├── src/
│   └── kpi_report/
│       ├── __init__.py       # Package entry point
│       ├── main.py           # Orchestrator (entry point)
│       ├── cli.py            # Argument parsing
│       ├── config.py         # Environment & project config
│       ├── constants.py      # Shared constants
│       ├── gitlab.py         # GitLab GraphQL API client
│       ├── processor.py      # Data transformation logic
│       └── report.py         # CSV/Excel output generation
├── input/                    # Input CSV files
├── output/                   # Generated reports
├── .env                      # Environment variables
├── projects.json             # Project configuration
├── pyproject.toml            # Project & build config
└── README.md
```
