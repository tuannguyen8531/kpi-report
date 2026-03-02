"""Command-line argument parsing."""

import argparse
import sys
from typing import Tuple


def parse_arguments() -> Tuple[int, int]:
    """Parse command line arguments for month and year.

    Returns:
        Tuple of (month, year).
    """
    parser = argparse.ArgumentParser(
        description='Generate KPI report from GitLab data'
    )
    parser.add_argument(
        '-m', '--month', type=int, required=True,
        help='Month (1-12)'
    )
    parser.add_argument(
        '-y', '--year', type=int, required=True,
        help='Year (e.g., 2025)'
    )

    args = parser.parse_args()

    if args.month < 1 or args.month > 12:
        parser.error("Month must be between 1 and 12")

    return args.month, args.year
