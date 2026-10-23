"""Main entry point: orchestrates config, data loading, processing, and report generation."""

import os
import sys
import math
from pathlib import Path

import pandas as pd

from .cli import parse_arguments
from .config import get_project_root, load_env, load_url_map, validate_projects_in_csv
from .gitlab import GraphQLClient
from .processor import (
    create_off_dataframe,
    create_project_dataframes,
    process_off_data,
    process_project_data,
)
from .report import save_report, format_excel_filename


def get_file_paths(month: int, year: int) -> tuple[str, str]:
    """Generate input and output file paths based on month and year.

    Paths are anchored to the project root so the CLI works
    regardless of the current working directory.
    """
    root = get_project_root()
    month_str = f"{month:02d}"
    input_file = root / f"input/tasks_{month_str}_{year}.csv"
    output_file = root / f"output/{year}/{month_str}/report_{month_str}_{year}.csv"
    return str(input_file), str(output_file)


def load_and_validate_data(input_file: str, url_map: dict) -> pd.DataFrame:
    """Load CSV data, parse dates, and validate project references."""
    if not os.path.exists(input_file):
        print(f"Input file {input_file} does not exist.")
        sys.exit(1)

    df = pd.read_csv(input_file, dtype={'Project': str, 'Task': str, 'Type': str})
    required = {'Project', 'Task', 'Type', 'Time', 'Date'}
    if not required.issubset(df.columns):
        raise ValueError(f"CSV is missing columns: {', '.join(sorted(required - set(df.columns)))}")
    if df[['Project', 'Task', 'Type', 'Date']].isna().any().any():
        raise ValueError('Project, Task, Type and Date must not be empty.')
    if not df['Type'].isin(['TASK', 'MR', 'MANUAL', 'OFF']).all():
        raise ValueError('Type must be TASK, MR, MANUAL or OFF.')
    df['Time'] = pd.to_numeric(df['Time'], errors='raise')
    if not df['Time'].map(math.isfinite).all():
        raise ValueError('Hours must be finite numbers.')
    manual_or_leave = df['Type'].isin(['MANUAL', 'OFF'])
    df.loc[manual_or_leave, 'Task'] = df.loc[manual_or_leave, 'Task'].str.strip().str.normalize('NFC')
    if not df.loc[manual_or_leave, 'Task'].str.len().between(1, 500).all():
        raise ValueError('Manual work names and leave reasons must contain 1–500 characters.')
    if not df.loc[manual_or_leave, 'Time'].between(0, 24, inclusive='right').all():
        raise ValueError('Manual work and leave hours must be greater than 0 and no more than 24.')
    df["Date"] = pd.to_datetime(df["Date"], format="%B %d, %Y")
    validate_projects_in_csv(df, url_map)
    return df


def main() -> None:
    """Main function to orchestrate the report generation."""
    # --- Parse CLI args first (so --help exits without side effects) ---
    args = parse_arguments()
    month, year = args.month, args.year

    # --- Initialization ---
    load_env()
    url_map = load_url_map()

    gitlab_url = os.getenv("GITLAB_URL", "")
    gitlab_token = os.getenv("GITLAB_TOKEN", "")

    # --- Resolve paths and load data ---
    input_file, output_file = get_file_paths(month, year)
    print(f"Input file: {input_file}")

    print("Loading and processing data...")
    df = load_and_validate_data(input_file, url_map)
    df = df[(df['Date'].dt.month == month) & (df['Date'].dt.year == year)]
    needs_gitlab = df['Type'].isin(['TASK', 'MR']).any()
    if needs_gitlab and (not gitlab_url or not gitlab_token):
        print("Error: GITLAB_URL and GITLAB_TOKEN must be set in .env file.")
        sys.exit(1)
    client = GraphQLClient(gitlab_url, gitlab_token)

    grouped_projects = process_project_data(df)

    output_dfs, stats = create_project_dataframes(
        grouped_projects, url_map, client, gitlab_url
    )
    off_df = create_off_dataframe(process_off_data(df))

    # --- Generate report ---
    excel_name = format_excel_filename(args.excel_pattern or os.getenv('EXCEL_PATTERN'), month, year)
    excel_file = str(Path(output_file).with_name(excel_name))
    save_report(output_dfs, output_file, stats, month=month, year=year, off_df=off_df, excel_file=excel_file)
    print("Successfully processed and exported:")
    print(f"  CSV:   {output_file}")
    print(f"  Excel: {excel_file}")


if __name__ == "__main__":
    main()
