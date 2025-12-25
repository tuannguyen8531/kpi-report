# KPI Report Generator

A CLI tool for generating KPI reports from GitLab data.

## Features

- Fetch work item and merge request data from GitLab API
- Generate CSV and Excel reports with formatted numbers
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
- For OFF entries:
  - Set `Project` to `OFF`
  - Set `Type` to `OFF`
  - Use `Task` column to describe the reason (e.g., "Annual Leave", "Sick Leave")
  - The task description will appear in the URL column of the output
- For TASK type: The tool will fetch additional data from GitLab (start date, due date, closed date, estimate)
- For MR type: The tool will fetch estimate from GitLab merge request
- Time can be decimal values (e.g., `4.5` for 4.5 hours)

## Usage

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
- `report_MM_YYYY.xlsx` - Excel format with comma decimal separators

## Project Structure

```
kpi-report/
├── src/
│   └── kpi_report/
│       ├── __init__.py
│       ├── main.py       # Main CLI logic
│       └── gitlab.py     # GitLab API client
├── input/               # Input CSV files
├── output/              # Generated reports
├── .env                 # Environment variables
├── projects.json        # Project configuration
├── pyproject.toml       # Project configuration
└── README.md
```