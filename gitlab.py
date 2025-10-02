import requests
from datetime import datetime

class GraphQLClient:
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
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }

    def execute_query(self, query, variables=None) -> dict:
        """
        Execute a GraphQL query and return the response.
        """
        data = {
            "query": query,
            "variables": variables
        }
        response = requests.post(self.url, headers=self.headers, json=data)
        return response.json()
    
    def get_work_item(self, full_path: str, iid: str) -> dict:
        """
        Get work item details by project full path and item IID.
        Returns dict with closed_date, start_date, due_date, estimate in MM/DD/YYYY format and hours.
        """
        variables = {
            "fullPath": full_path,
            "iid": iid
        }
        result = self.execute_query(self.query_task, variables)

        work_item_info = {
            "closed_date": "",
            "start_date": "",
            "due_date": "",
            "estimate": ""
        }
        
        try:
            work_items = result.get('data', {}).get('project', {}).get('workItems', {}).get('nodes', [])
            if not work_items:
                return work_item_info
                
            work_item = work_items[0]
            
            if work_item.get('closedAt'):
                closed_dt = datetime.fromisoformat(work_item['closedAt'].replace('Z', '+00:00'))
                work_item_info["closed_date"] = closed_dt.strftime('%m/%d/%Y')
            
            for widget in work_item.get('widgets', []):
                if 'startDate' in widget or 'dueDate' in widget:
                    if widget.get('startDate'):
                        start_dt = datetime.strptime(widget['startDate'], '%Y-%m-%d')
                        work_item_info["start_date"] = start_dt.strftime('%m/%d/%Y')
                    
                    if widget.get('dueDate'):
                        due_dt = datetime.strptime(widget['dueDate'], '%Y-%m-%d')
                        work_item_info["due_date"] = due_dt.strftime('%m/%d/%Y')
                
                elif 'timeEstimate' in widget and widget.get('timeEstimate'):
                    estimate_seconds = widget['timeEstimate']
                    estimate_hours = estimate_seconds / 3600
                    work_item_info["estimate"] = f"{estimate_hours:.2f}"
                        
        except Exception as e:
            print(f"Error processing work item data: {e}")
            
        return work_item_info
    
    def get_merge_request(self, full_path: str, iid: str) -> dict:
        """
        Get merge request details by project full path and MR IID.
        Returns dict with estimate in hours.
        """
        variables = {
            "fullPath": full_path,
            "iid": iid
        }
        result = self.execute_query(self.query_mr, variables)

        mr_info = {
            "estimate": ""
        }
        
        try:
            mrs = result.get('data', {}).get('project', {}).get('mergeRequests', {}).get('nodes', [])
            if not mrs:
                return mr_info
                
            mr = mrs[0]
            
            if mr.get('timeEstimate'):
                estimate_seconds = mr['timeEstimate']
                estimate_hours = estimate_seconds / 3600
                mr_info["estimate"] = f"{estimate_hours:.2f}"
                        
        except Exception as e:
            print(f"Error processing merge request data: {e}")
            
        return mr_info