import pandas as pd
from datetime import datetime
import os
import sys

URL_MAP = {
    'D-System': {
        'TASK': 'https://gitlab.widosoft.com/wido-cardgame-group/cardgame-system/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-cardgame-group/cardgame-system/-/merge_requests/'
    },
    'VILD-Gacha': {
        'TASK': 'https://gitlab.widosoft.com/wido-cardgame-group/vildgacha-system/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-cardgame-group/vildgacha-system/-/merge_requests/'
    },
    'Oripark-App': {
        'TASK': 'https://gitlab.widosoft.com/wido-cardgame-group/cardgameapp/oripark-app/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-cardgame-group/cardgameapp/oripark-app/-/merge_requests/'
    },
    'AI-Chat Service': {
        'TASK': 'https://gitlab.widosoft.com/wido-ai-chat/ai-chat-service/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-ai-chat/ai-chat-service/-/merge_requests/'
    },
    'AI-Chat Demo': {
        'TASK': 'https://gitlab.widosoft.com/wido-ai-chat/ai-chat-demo/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-ai-chat/ai-chat-demo/-/merge_requests/'
    },
    'AI-Embedding': {
        'TASK': 'https://gitlab.widosoft.com/wido-ai-chat/ai-embedding-service/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-ai-chat/ai-embedding-service/-/merge_requests/'
    },
    'OFF': {
        'OFF': ''
    }
}

OUTPUT_COLUMNS = [
    'Url', 'Start date', 'Due date', 'Closed date', 'Estimate', 
    'Spent', 'Reopen count', 'Task Type', 'Progress'
]


def parse_arguments():
    """Parse command line arguments for month and year."""
    if len(sys.argv) == 3:
        try:
            month = int(sys.argv[1])
            year = int(sys.argv[2])
            if month < 1 or month > 12:
                print("Month must be between 1 and 12")
                sys.exit(1)
            return month, year
        except ValueError:
            print("Month and year must be integers")
            sys.exit(1)
    else:
        now = datetime.now()
        return now.month, now.year


def get_file_paths(month, year):
    """Generate input and output file paths based on month and year."""
    month_str = f"{month:02d}"
    input_file = f"input/tasks_{month_str}_{year}.csv"
    output_file = f"output/report_{month_str}_{year}.csv"
    return input_file, output_file


def load_and_validate_data(input_file):
    """Load CSV data and validate file existence."""
    if not os.path.exists(input_file):
        print(f"Input file {input_file} does not exist.")
        sys.exit(1)
    
    df = pd.read_csv(input_file)
    df['Date'] = pd.to_datetime(df['Date'], format='%B %d, %Y')
    return df


def process_project_data(df):
    """Process project data and group by project, task, and type."""
    df_projects = df[df['Project'] != 'OFF']
    
    grouped_projects = df_projects.groupby(['Project', 'Task', 'Type']).agg(
        Start_date=('Date', 'min'),
        Spent=('Time', 'sum')
    ).reset_index()
    
    grouped_projects['Start_date'] = grouped_projects['Start_date'].dt.strftime('%m/%d/%Y')
    return grouped_projects


def process_off_data(df):
    """Process OFF (time off) data."""
    df_off = df[df['Project'] == 'OFF']
    grouped_off = df_off.copy()
    grouped_off['Start_date'] = grouped_off['Date']
    grouped_off['Spent'] = grouped_off['Time']
    grouped_off = grouped_off[['Project', 'Task', 'Type', 'Start_date', 'Spent']]
    grouped_off['Start_date'] = grouped_off['Start_date'].dt.strftime('%m/%d/%Y')
    return grouped_off


def get_url(row):
    """Generate URL for a task based on project and type."""
    project = row['Project']
    task_type = row['Type']
    task = row['Task']
    if project in URL_MAP and task_type in URL_MAP[project]:
        return URL_MAP[project][task_type] + str(task)
    return ''


def sort_projects_by_order(grouped_projects):
    """Sort projects according to URL_MAP order."""
    project_order = list(URL_MAP.keys())
    grouped_projects['Project_order'] = grouped_projects['Project'].apply(
        lambda x: project_order.index(x) if x in project_order else len(project_order)
    )
    return grouped_projects.sort_values(['Project_order', 'Start_date'])


def create_project_dataframes(grouped_projects):
    """Create output DataFrames for each project."""
    grouped_projects['Url'] = grouped_projects.apply(get_url, axis=1)
    grouped_projects = sort_projects_by_order(grouped_projects)
    
    output_dfs = []
    project_order = list(URL_MAP.keys())
    
    for project in project_order:
        if project == 'OFF':
            continue
        
        group = grouped_projects[grouped_projects['Project'] == project]
        if not group.empty:
            project_df = pd.DataFrame({
                'Url': group['Url'],
                'Start date': group['Start_date'],
                'Due date': '',
                'Closed date': '',
                'Estimate': '',
                'Spent': group['Spent'],
                'Reopen count': 0,
                'Task Type': 'Kế hoạch',
                'Progress': 'Đúng hạn'
            })
            output_dfs.append(project_df)
            
            blank_df = pd.DataFrame([[''] * len(OUTPUT_COLUMNS)], columns=OUTPUT_COLUMNS)
            output_dfs.append(blank_df)
    
    return output_dfs


def create_off_dataframe(grouped_off):
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


def save_report(output_dfs, off_df, output_file):
    """Save the final report to CSV file."""
    os.makedirs('output', exist_ok=True)
    
    output_dfs.append(off_df)
    final_df = pd.concat(output_dfs, ignore_index=True)
    final_df.to_csv(output_file, index=False, encoding='utf-8-sig')


def main():
    """Main function to orchestrate the report generation."""
    month, year = parse_arguments()
    input_file, output_file = get_file_paths(month, year)
    
    df = load_and_validate_data(input_file)
    
    grouped_projects = process_project_data(df)
    grouped_off = process_off_data(df)
    
    output_dfs = create_project_dataframes(grouped_projects)
    off_df = create_off_dataframe(grouped_off)
    
    save_report(output_dfs, off_df, output_file)
    
    print(f"Processed file {input_file} and exported to {output_file}")


if __name__ == "__main__":
    main()