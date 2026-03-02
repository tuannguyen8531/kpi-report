"""Data transformation: grouping, enrichment, and DataFrame assembly."""

import pandas as pd
from typing import Dict, Tuple, List, NamedTuple
from tqdm import tqdm

from .constants import OUTPUT_COLUMNS, DEFAULT_TASK_TYPE, DEFAULT_PROGRESS
from .gitlab import GraphQLClient


class ReportStats(NamedTuple):
    """Statistics accumulated during report processing."""
    total_tasks: int
    total_spent: float
    total_estimate: float


def process_project_data(df: pd.DataFrame) -> pd.DataFrame:
    """Process project data and group by project, task, and type.

    Aggregates time spent per task and finds the earliest work date.
    """
    df_projects = df[df['Project'] != 'OFF']

    grouped = df_projects.groupby(['Project', 'Task', 'Type']).agg(
        Start_date=('Date', 'min'),
        Spent=('Time', 'sum')
    ).reset_index()

    grouped['Start_date'] = grouped['Start_date'].dt.strftime('%m/%d/%Y')
    return grouped


def process_off_data(df: pd.DataFrame) -> pd.DataFrame:
    """Process OFF (time off) entries.

    Returns a DataFrame with columns: Project, Task, Type, Start_date, Spent.
    """
    df_off = df[df['Project'] == 'OFF'].copy()

    if df_off.empty:
        return pd.DataFrame(columns=['Project', 'Task', 'Type', 'Start_date', 'Spent'])

    # Use .assign() to avoid SettingWithCopyWarning
    df_off = df_off.assign(
        Start_date=df_off['Date'].dt.strftime('%m/%d/%Y'),
        Spent=df_off['Time'],
    )
    return df_off[['Project', 'Task', 'Type', 'Start_date', 'Spent']]


def get_url(row: pd.Series, url_map: Dict[str, str], gitlab_url: str) -> str:
    """Generate GitLab URL for a task based on project and type."""
    project = row['Project']
    task_type = row['Type']
    task = row['Task']

    if project == 'OFF':
        return 'OFF'

    project_path = url_map.get(project, '')
    if project_path:
        base_url = f"{gitlab_url}/{project_path}/-/"
        if task_type == 'TASK':
            return f"{base_url}work_items/{task}"
        elif task_type == 'MR':
            return f"{base_url}merge_requests/{task}"

    return ''


def sort_projects_by_order(
    grouped_projects: pd.DataFrame,
    url_map: Dict[str, str],
) -> pd.DataFrame:
    """Sort projects according to their order in the URL map."""
    project_order = list(url_map.keys())
    grouped_projects = grouped_projects.copy()
    grouped_projects['Project_order'] = grouped_projects['Project'].apply(
        lambda x: project_order.index(x) if x in project_order else len(project_order)
    )
    return grouped_projects.sort_values(['Project_order', 'Start_date'])


def get_gitlab_dates(
    project: str,
    task: str,
    task_type: str,
    url_map: Dict[str, str],
    client: GraphQLClient,
) -> Tuple[str, str, str, str]:
    """Fetch start_date, due_date, closed_date, and estimate from GitLab API.

    Returns:
        Tuple of (start_date, due_date, closed_date, estimate).
    """
    project_path = url_map.get(project, '')
    if project == 'OFF' or not project_path:
        return '', '', '', ''

    try:
        if task_type == 'TASK':
            data = client.get_work_item(project_path, str(task))
            return (
                data.get('start_date', ''),
                data.get('due_date', ''),
                data.get('closed_date', ''),
                data.get('estimate', ''),
            )
        elif task_type == 'MR':
            data = client.get_merge_request(project_path, str(task))
            return '', '', '', data.get('estimate', '')
        else:
            return '', '', '', ''
    except Exception as e:
        print(f"Error fetching GitLab data for {project} task {task}: {e}")
        return '', '', '', ''


def create_project_dataframes(
    grouped_projects: pd.DataFrame,
    url_map: Dict[str, str],
    client: GraphQLClient,
    gitlab_url: str,
) -> Tuple[List[pd.DataFrame], ReportStats]:
    """Create output DataFrames for each project with GitLab enrichment.

    Returns:
        Tuple of (list of DataFrames, accumulated ReportStats).
    """
    grouped_projects = grouped_projects.copy()
    grouped_projects['Url'] = grouped_projects.apply(
        lambda row: get_url(row, url_map, gitlab_url), axis=1
    )
    grouped_projects = sort_projects_by_order(grouped_projects, url_map)

    output_dfs: List[pd.DataFrame] = []
    project_order = list(url_map.keys())

    total_tasks = 0
    total_spent = 0.0
    total_estimate = 0.0

    print(f"Processing {len(grouped_projects)} tasks from GitLab API...")

    for project in project_order:
        if project == 'OFF':
            continue

        group = grouped_projects[grouped_projects['Project'] == project]
        if group.empty:
            continue

        print(f"Processing project: {project}")

        # Add project header row
        header_df = pd.DataFrame([{col: '' for col in OUTPUT_COLUMNS}])
        header_df.at[0, 'Url'] = project
        output_dfs.append(header_df)

        urls, start_dates, due_dates, closed_dates, estimates, spent_times = (
            [], [], [], [], [], []
        )

        for _, row in tqdm(
            group.iterrows(), total=len(group),
            desc=f"{project} tasks", leave=False,
        ):
            urls.append(row['Url'])
            spent_times.append(row['Spent'])

            gitlab_start, gitlab_due, gitlab_closed, gitlab_estimate = get_gitlab_dates(
                row['Project'], row['Task'], row['Type'], url_map, client
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

            # Accumulate stats directly (avoids re-deriving from output DataFrames)
            total_tasks += 1
            total_spent += float(row['Spent'])
            try:
                total_estimate += float(gitlab_estimate) if gitlab_estimate else 0
            except (ValueError, TypeError):
                pass

        project_df = pd.DataFrame({
            'Url': urls,
            'Start date': start_dates,
            'Due date': due_dates,
            'Closed date': closed_dates,
            'Estimate': estimates,
            'Spent': spent_times,
            'Reopen count': 0,
            'Task Type': DEFAULT_TASK_TYPE,
            'Progress': DEFAULT_PROGRESS,
        })
        output_dfs.append(project_df)

        blank_df = pd.DataFrame([[''] * len(OUTPUT_COLUMNS)], columns=OUTPUT_COLUMNS)
        output_dfs.append(blank_df)

    stats = ReportStats(
        total_tasks=total_tasks,
        total_spent=total_spent,
        total_estimate=total_estimate,
    )
    return output_dfs, stats


def create_off_dataframe(grouped_off: pd.DataFrame) -> pd.DataFrame:
    """Create output DataFrame for OFF entries."""
    if grouped_off.empty:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    off_df = pd.DataFrame({
        'Url': grouped_off['Task'].values,
        'Start date': grouped_off['Start_date'].values,
        'Due date': '',
        'Closed date': '',
        'Estimate': '',
        'Spent': grouped_off['Spent'].values,
        'Reopen count': 0,
        'Task Type': DEFAULT_TASK_TYPE,
        'Progress': DEFAULT_PROGRESS,
    })

    return off_df.sort_values('Start date')
