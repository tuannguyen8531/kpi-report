"""Main entry point: orchestrates config, data loading, processing, and report generation."""

import os
import sys

import pandas as pd

from .cli import parse_arguments
from .config import get_project_root, load_env, load_url_map, validate_projects_in_csv
from .gitlab import GraphQLClient
from .processor import (
    process_project_data,
    process_off_data,
    create_project_dataframes,
    create_off_dataframe,
)
from .report import save_report


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

    df = pd.read_csv(input_file)
    df['Date'] = pd.to_datetime(df['Date'], format='%B %d, %Y')
    validate_projects_in_csv(df, url_map)
    return df


def main() -> None:
    """Main function to orchestrate the report generation."""
    # --- Parse CLI args first (so --help exits without side effects) ---
    month, year = parse_arguments()

    # --- Initialization ---
    load_env()
    url_map = load_url_map()

    gitlab_url = os.getenv('GITLAB_URL', '')
    gitlab_token = os.getenv('GITLAB_TOKEN', '')

    if not gitlab_url or not gitlab_token:
        print("Error: GITLAB_URL and GITLAB_TOKEN must be set in .env file.")
        sys.exit(1)

    client = GraphQLClient(gitlab_url, gitlab_token)

    # --- Resolve paths and load data ---
    input_file, output_file = get_file_paths(month, year)
    print(f"Input file: {input_file}")

    print("Loading and processing data...")
    df = load_and_validate_data(input_file, url_map)

    grouped_projects = process_project_data(df)
    grouped_off = process_off_data(df)

    output_dfs, stats = create_project_dataframes(
        grouped_projects, url_map, client, gitlab_url
    )
    off_df = create_off_dataframe(grouped_off)

    # --- Generate report ---
    save_report(output_dfs, off_df, output_file, stats)

    excel_file = output_file.replace('.csv', '.xlsx')
    print("Successfully processed and exported:")
    print(f"  CSV:   {output_file}")
    print(f"  Excel: {excel_file}")


if __name__ == "__main__":
    main()