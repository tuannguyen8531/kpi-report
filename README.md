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

Create a `projects.txt` file:

```
ProjectName1=gitlab/full/path/to/project1
ProjectName2=gitlab/full/path/to/project2
OFF=
```

### 3. Input Data

Place your CSV files in the `input/` directory with the naming pattern:
`tasks_MM_YYYY.csv`

Example: `input/tasks_09_2025.csv`

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
├── projects.txt         # Project configuration
├── pyproject.toml       # Project configuration
└── README.md
```