import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes import ProjectUpdateRequest, update_project


class ProjectUpdateApiTests(unittest.TestCase):
    def setUp(self):
        self.user = {"sub": "project-owner"}
        self.project = {
            "id": "project-1",
            "owner_sub": "project-owner",
            "title": "Old title",
            "question": "Old research idea",
            "discipline": "psychology",
            "status": "draft",
            "modules": {
                "instruments": {"primary": {"instrument_type": "questionnaire"}},
                "literature_evidence": {"sources": [{"source_id": "source-1"}]},
            },
        }
        self.get_item = patch(
            "app.api.routes.projects_table.get_item",
            return_value={"Item": self.project},
        )
        self.get_item.start()
        self.addCleanup(self.get_item.stop)
        self.update_item = patch("app.api.routes.projects_table.update_item")
        self.mock_update = self.update_item.start()
        self.addCleanup(self.update_item.stop)

    def test_updates_details_without_replacing_existing_modules(self):
        updated = {
            **self.project,
            "title": "New title",
            "question": "New research idea",
            "discipline": "psychology",
        }
        self.mock_update.return_value = {"Attributes": updated}

        result = update_project(
            "project-1",
            ProjectUpdateRequest(
                title=" New title ",
                question=" New research idea ",
                discipline=" psychology ",
            ),
            user=self.user,
        )

        self.assertEqual(result["project"]["title"], "New title")
        self.assertEqual(result["project"]["question"], "New research idea")
        self.assertEqual(result["project"]["modules"], self.project["modules"])
        kwargs = self.mock_update.call_args.kwargs
        self.assertEqual(kwargs["ReturnValues"], "ALL_NEW")
        self.assertEqual(kwargs["ExpressionAttributeValues"][":owner"], "project-owner")
        self.assertNotIn("modules", kwargs["UpdateExpression"])

    def test_rejects_project_owned_by_another_user(self):
        self.project["owner_sub"] = "different-owner"

        with self.assertRaises(HTTPException) as raised:
            update_project(
                "project-1",
                ProjectUpdateRequest(
                    title="New title",
                    question="New idea",
                    discipline="psychology",
                ),
                user=self.user,
            )

        self.assertEqual(raised.exception.status_code, 404)
        self.mock_update.assert_not_called()
