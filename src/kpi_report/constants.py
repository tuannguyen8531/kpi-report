"""Shared constants for the work report generator."""

import re

MANUAL_PROJECT = 'Nghiên cứu'


def project_name(name: str) -> str:
    """Hide the GitLab path in report labels, keeping it in project identifiers."""
    return re.sub(r'\s+\([^()]*\/[^()]*\)$', '', name)

OUTPUT_COLUMNS = [
    'Url', 'Start date', 'Due date', 'Closed date', 'Estimate',
    'Spent', 'Reopen count', 'Task Type', 'Progress'
]

DEFAULT_TASK_TYPE = 'Kế hoạch'
DEFAULT_PROGRESS = 'Đúng hạn'
