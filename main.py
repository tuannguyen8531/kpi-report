import pandas as pd
from datetime import datetime

# Hardcoded URLs for each project and type
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
    'AI-Embedding': {
        'TASK': 'https://gitlab.widosoft.com/wido-ai-chat/ai-embedding-service/-/work_items/',
        'MR': 'https://gitlab.widosoft.com/wido-ai-chat/ai-embedding-service/-/merge_requests/'
    },
    'OFF': {
        'OFF': ''  # Empty for OFF
    }
}

# Read the CSV file
df = pd.read_csv('tasks.csv')

# Convert Date to datetime
df['Date'] = pd.to_datetime(df['Date'], format='%B %d, %Y')

# Filter out OFF for initial processing
df_projects = df[df['Project'] != 'OFF']
df_off = df[df['Project'] == 'OFF']

# Group by Project, Task, Type for projects
grouped_projects = df_projects.groupby(['Project', 'Task', 'Type']).agg(
    Start_date=('Date', 'min'),
    Spent=('Time', 'sum')
).reset_index()

# For OFF, do not sum if instruction is not to sum, but according to "Không được cộng thời gian", perhaps keep separate lines
# But to match previous, we'll group if same Task, but in data Speech is same but different dates
# Instruction: "Không được cộng thời gian của các dòng dữ liệu được đánh PROJECT là OFF"
# So, keep OFF as separate rows, no grouping
grouped_off = df_off.copy()
grouped_off['Start_date'] = grouped_off['Date']
grouped_off['Spent'] = grouped_off['Time']
# Drop unnecessary columns
grouped_off = grouped_off[['Project', 'Task', 'Type', 'Start_date', 'Spent']]

# Format dates to MM/DD/YYYY
grouped_projects['Start_date'] = grouped_projects['Start_date'].dt.strftime('%m/%d/%Y')
grouped_off['Start_date'] = grouped_off['Start_date'].dt.strftime('%m/%d/%Y')

# Create the output DataFrame structure
output_columns = ['Url', 'Start date', 'Due date', 'Closed date', 'Estimate', 'Spent', 'Reopen count', 'Task Type', 'Progress']

# Function to get URL
def get_url(row):
    project = row['Project']
    task_type = row['Type']
    task = row['Task']
    if project in url_map and task_type in url_map[project]:
        return url_map[project][task_type] + str(task)
    return ''

# Add URL to grouped_projects
grouped_projects['Url'] = grouped_projects.apply(get_url, axis=1)

# Add URL to grouped_off (empty)
grouped_off['Url'] = ''

# Now, sort projects in desired order
project_order = ['D-System', 'Oripark-App', 'VILD-Gacha', 'AI-Chat Service', 'AI-Embedding']
grouped_projects['Project_order'] = grouped_projects['Project'].apply(lambda x: project_order.index(x) if x in project_order else len(project_order))
grouped_projects = grouped_projects.sort_values(['Project_order', 'Start_date'])

# Prepare list of DataFrames for each project
project_groups = grouped_projects.groupby('Project')

output_dfs = []
for project, group in project_groups:
    # Select relevant columns and add fixed ones
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
    # Add blank row DataFrame
    blank_df = pd.DataFrame([[''] * len(output_columns)], columns=output_columns)
    output_dfs.append(blank_df)

# Now for OFF
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
# Sort OFF by Start_date
off_df = off_df.sort_values('Start date')
output_dfs.append(off_df)

# Concat all
final_df = pd.concat(output_dfs, ignore_index=True)

# Save to CSV
final_df.to_csv('report.csv', index=False, encoding='utf-8-sig')