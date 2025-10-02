import pandas as pd
from datetime import datetime
import os
import sys

url_map = {
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

if len(sys.argv) == 3:
    try:
        month = int(sys.argv[1])
        year = int(sys.argv[2])
        if month < 1 or month > 12:
            print("Month must be between 1 and 12")
            exit(1)
    except ValueError:
        print("Month and year must be integers")
        exit(1)
else:
    month = datetime.now().month
    year = datetime.now().year

month_str = f"{month:02d}"
input_file = f"input/tasks_{month_str}_{year}.csv"
output_file = f"output/report_{month_str}_{year}.csv"

if not os.path.exists(input_file):
    print(f"Input file {input_file} does not exist.")
    exit(1)

df = pd.read_csv(input_file)

df['Date'] = pd.to_datetime(df['Date'], format='%B %d, %Y')

df_projects = df[df['Project'] != 'OFF']
df_off = df[df['Project'] == 'OFF']

grouped_projects = df_projects.groupby(['Project', 'Task', 'Type']).agg(
    Start_date=('Date', 'min'),
    Spent=('Time', 'sum')
).reset_index()

grouped_off = df_off.copy()
grouped_off['Start_date'] = grouped_off['Date']
grouped_off['Spent'] = grouped_off['Time']
grouped_off = grouped_off[['Project', 'Task', 'Type', 'Start_date', 'Spent']]

grouped_projects['Start_date'] = grouped_projects['Start_date'].dt.strftime('%m/%d/%Y')
grouped_off['Start_date'] = grouped_off['Start_date'].dt.strftime('%m/%d/%Y')

output_columns = ['Url', 'Start date', 'Due date', 'Closed date', 'Estimate', 'Spent', 'Reopen count', 'Task Type', 'Progress']

def get_url(row):
    project = row['Project']
    task_type = row['Type']
    task = row['Task']
    if project in url_map and task_type in url_map[project]:
        return url_map[project][task_type] + str(task)
    return ''

grouped_projects['Url'] = grouped_projects.apply(get_url, axis=1)
grouped_off['Url'] = 'OFF'

project_order = ['D-System', 'Oripark-App', 'VILD-Gacha', 'AI-Chat Service', 'AI-Embedding']
grouped_projects['Project_order'] = grouped_projects['Project'].apply(lambda x: project_order.index(x) if x in project_order else len(project_order))
grouped_projects = grouped_projects.sort_values(['Project_order', 'Start_date'])
project_groups = grouped_projects.groupby('Project')

output_dfs = []
for project, group in project_groups:
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
    blank_df = pd.DataFrame([[''] * len(output_columns)], columns=output_columns)
    output_dfs.append(blank_df)

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

off_df = off_df.sort_values('Start date')
output_dfs.append(off_df)

os.makedirs('output', exist_ok=True)

final_df = pd.concat(output_dfs, ignore_index=True)
final_df.to_csv(output_file, index=False, encoding='utf-8-sig')

print(f"Processed file {input_file} and exported to {output_file}")