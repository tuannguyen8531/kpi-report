import pandas as pd
import os
import sys
import json
import argparse
from typing import Dict, Tuple, List
from dotenv import load_dotenv
from .gitlab import GraphQLClient
from tqdm import tqdm

# Load environment variables
load_dotenv()


def load_url_map() -> Dict[str, str]:
    """Load URL_MAP from projects.json file."""
    url_map = {}
    projects_file = 'projects.json'
    
    if not os.path.exists(projects_file):
        print(f"Error: {projects_file} not found. Please create this file with project configurations.")
        print('Format: [{"project": "ProjectName", "url": "gitlab/full/path"}]')
        sys.exit(1)
    
    try:
        with open(projects_file, 'r', encoding='utf-8') as f:
            projects = json.load(f)
            for item in projects:
                project = item.get('project', '').strip()
                url = item.get('url', '').strip()
                if project:
                    url_map[project] = url
        print(f"Loaded {len(url_map)} projects from {projects_file}")
        return url_map
    except Exception as e:
        print(f"Error reading {projects_file}: {e}")
        sys.exit(1)


URL_MAP = load_url_map()

OUTPUT_COLUMNS = [
    'Url', 'Start date', 'Due date', 'Closed date', 'Estimate', 
    'Spent', 'Reopen count', 'Task Type', 'Progress'
]


graphql_client = GraphQLClient(os.getenv('GITLAB_URL'), os.getenv('GITLAB_TOKEN'))


def parse_arguments() -> Tuple[int, int]:
    """Parse command line arguments for month and year."""
    parser = argparse.ArgumentParser(description='Generate KPI report from GitLab data')
    parser.add_argument('-m', '--month', type=int, required=True,
                       help='Month (1-12)')
    parser.add_argument('-y', '--year', type=int, required=True,
                       help='Year (e.g., 2025)')
    
    args = parser.parse_args()
    
    if args.month < 1 or args.month > 12:
        print("Month must be between 1 and 12")
        sys.exit(1)
    
    return args.month, args.year


def get_file_paths(month: int, year: int) -> Tuple[str, str]:
    """Generate input and output file paths based on month and year."""
    month_str = f"{month:02d}"
    input_file = f"input/tasks_{month_str}_{year}.csv"
    output_file = f"output/report_{month_str}_{year}.csv"
    return input_file, output_file


def load_and_validate_data(input_file: str) -> pd.DataFrame:
    """Load CSV data and validate file existence."""
    if not os.path.exists(input_file):
        print(f"Input file {input_file} does not exist.")
        sys.exit(1)
    
    df = pd.read_csv(input_file)
    df['Date'] = pd.to_datetime(df['Date'], format='%B %d, %Y')

    validate_projects_in_csv(df)
    
    return df


def validate_projects_in_csv(df: pd.DataFrame) -> None:
    """Validate that all projects in CSV exist in URL_MAP."""
    csv_projects = df['Project'].unique()
    missing_projects = []
    
    for project in csv_projects:
        if project not in URL_MAP:
            missing_projects.append(project)
    
    if missing_projects:
        print("Error: The following projects in CSV are not configured in projects.json:")
        for project in missing_projects:
            print(f"  - {project}")
        print(f"\nPlease add these projects to projects.json with format:")
        print('{"project": "ProjectName", "url": "gitlab/full/path"}')
        sys.exit(1)


def process_project_data(df: pd.DataFrame) -> pd.DataFrame:
    """Process project data and group by project, task, and type."""
    df_projects = df[df['Project'] != 'OFF']
    
    grouped_projects = df_projects.groupby(['Project', 'Task', 'Type']).agg(
        Start_date=('Date', 'min'),
        Spent=('Time', 'sum')
    ).reset_index()
    
    grouped_projects['Start_date'] = grouped_projects['Start_date'].dt.strftime('%m/%d/%Y')
    return grouped_projects


def process_off_data(df: pd.DataFrame) -> pd.DataFrame:
    """Process OFF (time off) data."""
    df_off = df[df['Project'] == 'OFF']
    grouped_off = df_off.copy()
    grouped_off['Start_date'] = grouped_off['Date']
    grouped_off['Spent'] = grouped_off['Time']
    grouped_off = grouped_off[['Project', 'Task', 'Type', 'Start_date', 'Spent']]
    grouped_off['Start_date'] = grouped_off['Start_date'].dt.strftime('%m/%d/%Y')
    return grouped_off


def get_url(row: pd.Series) -> str:
    """Generate URL for a task based on project and type."""
    project = row['Project']
    task_type = row['Type']
    task = row['Task']
    
    if project == 'OFF':
        return 'OFF'
    
    gitlab_url = os.getenv('GITLAB_URL')
    if project in URL_MAP and URL_MAP[project]:
        base_url = f"{gitlab_url}/{URL_MAP[project]}/-/"
        if task_type == 'TASK':
            return f"{base_url}work_items/{task}"
        elif task_type == 'MR':
            return f"{base_url}merge_requests/{task}"
    
    return ''


def sort_projects_by_order(grouped_projects: pd.DataFrame) -> pd.DataFrame:
    """Sort projects according to URL_MAP order."""
    project_order = list(URL_MAP.keys())
    grouped_projects['Project_order'] = grouped_projects['Project'].apply(
        lambda x: project_order.index(x) if x in project_order else len(project_order)
    )
    return grouped_projects.sort_values(['Project_order', 'Start_date'])


def get_gitlab_dates(project: str, task: int, task_type: str) -> Tuple[str, str, str, str]:
    """Get start_date, due_date, closed_date, and estimate from GitLab API."""
    if project == 'OFF' or project not in URL_MAP or not URL_MAP[project]:
        return '', '', '', ''
    
    try:
        if task_type == 'TASK':
            work_item_data = graphql_client.get_work_item(URL_MAP[project], str(task))
            return (
                work_item_data.get('start_date', ''),
                work_item_data.get('due_date', ''),
                work_item_data.get('closed_date', ''),
                work_item_data.get('estimate', '')
            )
        elif task_type == 'MR':
            mr_data = graphql_client.get_merge_request(URL_MAP[project], str(task))
            estimate = mr_data.get('estimate', '')
            return '', '', '', estimate
        else:
            return '', '', '', ''
    except Exception as e:
        print(f"Error fetching GitLab data for {project} task {task}: {e}")
        return '', '', '', ''


def create_project_dataframes(grouped_projects: pd.DataFrame) -> List[pd.DataFrame]:
    """Create output DataFrames for each project."""
    grouped_projects['Url'] = grouped_projects.apply(get_url, axis=1)
    grouped_projects = sort_projects_by_order(grouped_projects)
    
    output_dfs = []
    project_order = list(URL_MAP.keys())
    
    # Count total tasks for progress tracking
    total_tasks = len(grouped_projects)
    print(f"Processing {total_tasks} tasks from GitLab API...")
    
    for project in project_order:
        if project == 'OFF':
            continue
        
        group = grouped_projects[grouped_projects['Project'] == project]
        if not group.empty:
            print(f"Processing project: {project}")
            
            # Add project header
            project_header_df = pd.DataFrame([{
                'Url': f"=== {project} ===",
                'Start date': '',
                'Due date': '',
                'Closed date': '',
                'Estimate': '',
                'Spent': '',
                'Reopen count': '',
                'Task Type': '',
                'Progress': ''
            }])
            output_dfs.append(project_header_df)
            
            urls = []
            start_dates = []
            due_dates = []
            closed_dates = []
            estimates = []
            spent_times = []
            
            # Use tqdm for progress bar within each project
            for _, row in tqdm(group.iterrows(), total=len(group), desc=f"{project} tasks", leave=False):
                urls.append(row['Url'])
                spent_times.append(row['Spent'])
                
                gitlab_start, gitlab_due, gitlab_closed, gitlab_estimate = get_gitlab_dates(
                    row['Project'], row['Task'], row['Type']
                )
                
                if row['Type'] == 'MR':
                    final_start = row['Start_date']
                    final_due = row['Start_date']
                    final_closed = row['Start_date']
                else:
                    final_start = gitlab_start if gitlab_start else row['Start_date']
                    final_due = gitlab_due
                    final_closed = gitlab_closed
                
                start_dates.append(final_start)
                due_dates.append(final_due)
                closed_dates.append(final_closed)
                estimates.append(gitlab_estimate)
            
            project_df = pd.DataFrame({
                'Url': urls,
                'Start date': start_dates,
                'Due date': due_dates,
                'Closed date': closed_dates,
                'Estimate': estimates,
                'Spent': spent_times,
                'Reopen count': 0,
                'Task Type': 'Kế hoạch',
                'Progress': 'Đúng hạn'
            })
            output_dfs.append(project_df)
            
            blank_df = pd.DataFrame([[''] * len(OUTPUT_COLUMNS)], columns=OUTPUT_COLUMNS)
            output_dfs.append(blank_df)
    
    return output_dfs


def create_off_dataframe(grouped_off: pd.DataFrame) -> pd.DataFrame:
    """Create output DataFrame for OFF entries."""
    grouped_off['Url'] = 'OFF'
    
    off_df = pd.DataFrame({
        'Url': grouped_off['Url'],
        'Start date': grouped_off['Start_date'],
        'Due date': '',
        'Closed date': '',
        'Estimate': '',
        'Spent': grouped_off['Spent'],
        'Reopen count': 0,
        'Task Type': 'Kế hoạch',
        'Progress': 'Đúng hạn'
    })
    
    return off_df.sort_values('Start date')


def save_report(output_dfs: List[pd.DataFrame], off_df: pd.DataFrame, output_file: str) -> None:
    """Save the final report to CSV and Excel files."""
    os.makedirs('output', exist_ok=True)
    
    print("Combining data and creating final report...")
    
    # Add OFF header if there's OFF data
    if not off_df.empty:
        off_header_df = pd.DataFrame([{
            'Url': "=== OFF ===",
            'Start date': '',
            'Due date': '',
            'Closed date': '',
            'Estimate': '',
            'Spent': '',
            'Reopen count': '',
            'Task Type': '',
            'Progress': ''
        }])
        output_dfs.append(off_header_df)
    
    output_dfs.append(off_df)
    final_df = pd.concat(output_dfs, ignore_index=True)
    
    # Save CSV file
    print(f"Saving CSV file: {output_file}")
    final_df.to_csv(output_file, index=False, encoding='utf-8-sig')
    
    # Create Excel file with comma decimal format
    excel_file = output_file.replace('.csv', '.xlsx')
    print(f"Creating Excel file: {excel_file}")
    save_excel_report(final_df, excel_file)


def save_excel_report(df: pd.DataFrame, excel_file: str) -> None:
    """Save DataFrame to Excel with comma decimal format for Estimate and Spent columns."""
    # Create a copy of the dataframe to avoid modifying the original
    df_excel = df.copy()
    
    # Convert numeric columns from dot to comma format
    for col in ['Estimate', 'Spent']:
        df_excel[col] = df_excel[col].astype(str).str.replace('.', ',', regex=False)
    
    # Save to Excel
    with pd.ExcelWriter(excel_file, engine='openpyxl') as writer:
        df_excel.to_excel(writer, sheet_name='Report', index=False)
        
        # Get the workbook and worksheet
        workbook = writer.book
        worksheet = writer.sheets['Report']
        
        # Auto-adjust column widths
        for column in worksheet.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)  # Max width of 50
            worksheet.column_dimensions[column_letter].width = adjusted_width


def main() -> None:
    """Main function to orchestrate the report generation."""
    month, year = parse_arguments()
    input_file, output_file = get_file_paths(month, year)
    
    print(f"Input file: {input_file}")
    
    print("Loading and processing data...")
    df = load_and_validate_data(input_file)
    
    grouped_projects = process_project_data(df)
    grouped_off = process_off_data(df)
    
    output_dfs = create_project_dataframes(grouped_projects)
    off_df = create_off_dataframe(grouped_off)
    
    save_report(output_dfs, off_df, output_file)
    
    excel_file = output_file.replace('.csv', '.xlsx')
    print(f"Successfully processed and exported:")
    print(f"CSV: {output_file}")
    print(f"Excel: {excel_file}")


if __name__ == "__main__":
    main()