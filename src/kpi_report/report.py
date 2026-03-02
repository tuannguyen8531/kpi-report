"""Report output generation: CSV and Excel files."""

import os
import pandas as pd
from typing import List

from .constants import OUTPUT_COLUMNS
from .processor import ReportStats


def save_report(
    output_dfs: List[pd.DataFrame],
    off_df: pd.DataFrame,
    output_file: str,
    stats: ReportStats,
) -> None:
    """Save the final report to CSV and Excel files.

    Args:
        output_dfs: List of project DataFrames (with headers and separators).
        off_df: DataFrame of OFF entries.
        output_file: Path to the output CSV file.
        stats: Accumulated report statistics.
    """
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    print("Combining data and creating final report...")

    # Add OFF section
    if not off_df.empty:
        off_header = pd.DataFrame([{col: '' for col in OUTPUT_COLUMNS}])
        off_header.at[0, 'Url'] = 'OFF'
        output_dfs.append(off_header)
        output_dfs.append(off_df)

    # Blank separator before summary
    blank_df = pd.DataFrame([[''] * len(OUTPUT_COLUMNS)], columns=OUTPUT_COLUMNS)
    output_dfs.append(blank_df)

    # Summary rows
    summary_rows = [
        {'Url': 'Number of tasks: ', 'Start date': str(stats.total_tasks)},
        {'Url': 'Total spent time:', 'Start date': str(stats.total_spent)},
        {'Url': 'Total estimate time:', 'Start date': str(stats.total_estimate)},
    ]
    for row in summary_rows:
        for col in OUTPUT_COLUMNS:
            row.setdefault(col, '')
    output_dfs.append(pd.DataFrame(summary_rows))

    final_df = pd.concat(output_dfs, ignore_index=True)

    # Save CSV
    print(f"Saving CSV file: {output_file}")
    final_df.to_csv(output_file, index=False, encoding='utf-8-sig')

    # Save Excel
    excel_file = output_file.replace('.csv', '.xlsx')
    print(f"Creating Excel file: {excel_file}")
    _save_excel(final_df, excel_file)


def _save_excel(df: pd.DataFrame, excel_file: str) -> None:
    """Save DataFrame to Excel with comma decimal format for numeric columns."""
    df_excel = df.copy()

    # Convert decimal separator from dot to comma for locale compatibility
    for col in ['Estimate', 'Spent']:
        df_excel[col] = df_excel[col].astype(str).str.replace('.', ',', regex=False)

    with pd.ExcelWriter(excel_file, engine='openpyxl') as writer:
        df_excel.to_excel(writer, sheet_name='Report', index=False)
        worksheet = writer.sheets['Report']

        # Auto-adjust column widths
        for column in worksheet.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except Exception:
                    pass
            adjusted_width = min(max_length + 2, 50)
            worksheet.column_dimensions[column_letter].width = adjusted_width
