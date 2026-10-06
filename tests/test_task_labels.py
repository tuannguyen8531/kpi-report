"""Work item labels drive report classification without changing MR defaults."""

import unittest
from unittest.mock import patch

import pandas as pd

from kpi_report.gitlab import GraphQLClient
from kpi_report.processor import create_project_dataframes


def response(titles, has_next=False, cursor=None):
    return {"data": {"project": {"workItems": {"nodes": [{
        "closedAt": "2026-10-03T12:00:00Z",
        "widgets": [
            {"startDate": "2026-10-01", "dueDate": "2026-10-04"},
            {"timeEstimate": 7200},
            {"labels": {"nodes": [{"title": title} for title in titles],
                        "pageInfo": {"hasNextPage": has_next, "endCursor": cursor}}},
        ],
    }]}}}}


class TaskLabelTest(unittest.TestCase):
    def test_exact_case_insensitive_label(self):
        client = GraphQLClient("https://gitlab.example.com", "test")
        for labels, expected in [
            (["UNPLANNED"], "Phát sinh"), ([" unplanned "], "Phát sinh"),
            (["UnPlAnNeD"], "Phát sinh"), ([], "Kế hoạch"),
            (["NOT_UNPLANNED", "type::UNPLANNED"], "Kế hoạch"),
        ]:
            with self.subTest(labels=labels), patch.object(client, "execute_query", return_value=response(labels)):
                info = client.get_work_item("group/app", "1")
                self.assertEqual(info["task_type"], expected)
                self.assertEqual(info["estimate"], "2.00")
                self.assertEqual(info["start_date"], "10/01/2026")
                self.assertEqual(info["due_date"], "10/04/2026")
                self.assertEqual(info["closed_date"], "10/03/2026")
        with patch.object(client, "execute_query", return_value=response([])):
            self.assertEqual(client.get_work_item("group/app", "1")["task_type"], "Kế hoạch")

    def test_paginated_labels_reach_report_and_mr_stays_planned(self):
        client = GraphQLClient("https://gitlab.example.com", "test")
        rows = pd.DataFrame([
            {"Project": "App", "Task": "1", "Type": kind, "Start_date": "10/01/2026", "Spent": 2}
            for kind in ["TASK", "MR"]
        ])
        pages = [response(["backend"], True, "next"), response(["UNPLANNED"])]
        with patch.object(client, "execute_query", side_effect=pages) as query, patch.object(
            client, "get_merge_request", return_value={"estimate": "1.00", "task_type": "Phát sinh"}
        ):
            frames, stats = create_project_dataframes(rows, {"App": "group/app"}, client, "https://gitlab.example.com")
        self.assertEqual(query.call_count, 2)
        self.assertEqual(query.call_args.args[1]["labelsAfter"], "next")
        self.assertIn("... on WorkItemWidgetLabels", query.call_args.args[0])
        self.assertEqual(frames[1]["Task Type"].tolist(), ["Phát sinh", "Kế hoạch"])
        self.assertEqual(stats.total_tasks, 2)
        self.assertEqual(stats.total_estimate, 3)
