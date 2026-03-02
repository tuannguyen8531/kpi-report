"""GitLab GraphQL API client with retry logic and proper error handling."""

import requests
from datetime import datetime
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

REQUEST_TIMEOUT = 30  # seconds


class GraphQLClient:
    """Client for querying GitLab's GraphQL API."""

    query_task = """
    query($fullPath: ID!, $iid: String!) {
        project(fullPath: $fullPath) {
            workItems(iid: $iid) {
                nodes {
                    closedAt
                    widgets {
                        ... on WorkItemWidgetStartAndDueDate {
                            startDate
                            dueDate
                        }
                        ... on WorkItemWidgetTimeTracking {
                            timeEstimate
                        }
                    }
                }
            }
        }
    }
    """

    query_mr = """
    query($fullPath: ID!, $iid: String!) {
        project(fullPath: $fullPath) {
            mergeRequests(iids: [$iid]) {
                nodes {
                    timeEstimate
                }
            }
        }
    }
    """

    def __init__(self, url: str, token: str):
        self.url = f"{url}/api/graphql"
        self.session = self._create_session(token)

    @staticmethod
    def _create_session(token: str) -> requests.Session:
        """Create a requests session with retry logic and connection pooling."""
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        })
        retries = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[500, 502, 503, 504],
        )
        session.mount("https://", HTTPAdapter(max_retries=retries))
        session.mount("http://", HTTPAdapter(max_retries=retries))
        return session

    def execute_query(self, query: str, variables: dict | None = None) -> dict:
        """Execute a GraphQL query and return the response.

        Raises:
            requests.HTTPError: On non-2xx HTTP responses.
            RuntimeError: On GraphQL-level errors.
        """
        payload = {"query": query, "variables": variables}
        response = self.session.post(self.url, json=payload, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()

        result = response.json()
        if "errors" in result:
            raise RuntimeError(f"GraphQL errors: {result['errors']}")
        return result

    def get_work_item(self, full_path: str, iid: str) -> dict:
        """Get work item details by project full path and item IID.

        Returns:
            Dict with keys: closed_date, start_date, due_date, estimate
            (values in MM/DD/YYYY format for dates, hours for estimate).
        """
        variables = {"fullPath": full_path, "iid": iid}
        result = self.execute_query(self.query_task, variables)

        work_item_info = {
            "closed_date": "",
            "start_date": "",
            "due_date": "",
            "estimate": "",
        }

        try:
            nodes = (
                result.get("data", {})
                .get("project", {})
                .get("workItems", {})
                .get("nodes", [])
            )
            if not nodes:
                return work_item_info

            work_item = nodes[0]

            if work_item.get("closedAt"):
                closed_dt = datetime.fromisoformat(
                    work_item["closedAt"].replace("Z", "+00:00")
                )
                work_item_info["closed_date"] = closed_dt.strftime("%m/%d/%Y")

            for widget in work_item.get("widgets", []):
                if "startDate" in widget or "dueDate" in widget:
                    if widget.get("startDate"):
                        start_dt = datetime.strptime(widget["startDate"], "%Y-%m-%d")
                        work_item_info["start_date"] = start_dt.strftime("%m/%d/%Y")
                    if widget.get("dueDate"):
                        due_dt = datetime.strptime(widget["dueDate"], "%Y-%m-%d")
                        work_item_info["due_date"] = due_dt.strftime("%m/%d/%Y")

                elif "timeEstimate" in widget and widget.get("timeEstimate"):
                    estimate_hours = widget["timeEstimate"] / 3600
                    work_item_info["estimate"] = f"{estimate_hours:.2f}"

        except Exception as e:
            print(f"Error processing work item data: {e}")

        return work_item_info

    def get_merge_request(self, full_path: str, iid: str) -> dict:
        """Get merge request details by project full path and MR IID.

        Returns:
            Dict with key: estimate (in hours).
        """
        variables = {"fullPath": full_path, "iid": iid}
        result = self.execute_query(self.query_mr, variables)

        mr_info = {"estimate": ""}

        try:
            nodes = (
                result.get("data", {})
                .get("project", {})
                .get("mergeRequests", {})
                .get("nodes", [])
            )
            if not nodes:
                return mr_info

            mr = nodes[0]
            if mr.get("timeEstimate"):
                estimate_hours = mr["timeEstimate"] / 3600
                mr_info["estimate"] = f"{estimate_hours:.2f}"

        except Exception as e:
            print(f"Error processing merge request data: {e}")

        return mr_info