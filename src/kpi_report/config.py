"""Configuration loading: environment variables and project mappings."""

import json
import sys
from pathlib import Path
from typing import Dict

import pandas as pd
from dotenv import load_dotenv


def get_project_root() -> Path:
    """Get the project root directory (where pyproject.toml lives).

    This resolves paths relative to the source tree so the CLI works
    regardless of the current working directory.
    """
    # src/kpi_report/config.py -> src/kpi_report -> src -> project root
    return Path(__file__).resolve().parent.parent.parent


def load_env() -> None:
    """Load environment variables from .env file at project root."""
    env_file = get_project_root() / '.env'
    load_dotenv(env_file)


def load_url_map() -> Dict[str, str]:
    """Load project-to-URL mapping from projects.json.

    Returns:
        Dictionary mapping project names to their GitLab paths.
    """
    url_map: Dict[str, str] = {}
    projects_file = get_project_root() / 'projects.json'

    if not projects_file.exists():
        print(f"Error: {projects_file} not found.")
        print("Please create this file with project configurations.")
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
        print(f"Loaded {len(url_map)} projects from projects.json")
        return url_map
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {projects_file}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading {projects_file}: {e}")
        sys.exit(1)


def validate_projects_in_csv(df: pd.DataFrame, url_map: Dict[str, str]) -> None:
    """Validate that all projects referenced in the CSV exist in the URL map."""
    csv_projects = df['Project'].unique()
    missing = [p for p in csv_projects if p not in url_map]

    if missing:
        print("Error: The following projects in CSV are not configured in projects.json:")
        for project in missing:
            print(f"  - {project}")
        print('\nPlease add these projects to projects.json with format:')
        print('{"project": "ProjectName", "url": "gitlab/full/path"}')
        sys.exit(1)
