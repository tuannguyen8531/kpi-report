"""Command-line argument parsing."""

import argparse


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments for month and year.

    Returns:
        Reporting month, year and optional Excel filename pattern.
    """
    parser = argparse.ArgumentParser(
        description='Generate monthly work reports from GitLab and manual work'
    )
    parser.add_argument(
        '-m', '--month', type=int, required=True,
        help='Month (1-12)'
    )
    parser.add_argument(
        '-y', '--year', type=int, required=True,
        help='Year (e.g., 2025)'
    )

    parser.add_argument('--excel-pattern', help='Excel filename with MM and YYYY placeholders (or EXCEL_PATTERN in .env)')
    args = parser.parse_args()

    if args.month < 1 or args.month > 12:
        parser.error("Month must be between 1 and 12")
    if not 1 <= args.year <= 9999:
        parser.error("Year must be between 1 and 9999")

    return args
