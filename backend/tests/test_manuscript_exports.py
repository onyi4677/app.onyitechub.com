import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException

from app.services import manuscript_exports


class FakeTable:
    def get_item(self, **kwargs):
        return {
            "Item": {
                "project_id": "project-1",
                "record_key": "VERSION#version-1",
                "manuscript_id": "manuscript-1",
            }
        }

    def query(self, **kwargs):
        return {
            "Items": [
                {
                    "project_id": "project-1",
                    "record_key": "SECTION#version-1#abstract",
                    "manuscript_id": "manuscript-1",
                    "version_id": "version-1",
                    "section_id": "abstract",
                    "title": "Abstract",
                    "order": 1,
                    "content": "Draft abstract",
                    "status": "draft",
                }
            ]
        }


class FakeS3:
    def __init__(self):
        self.put_calls = []
        self.sign_calls = []

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.sign_calls.append((operation, Params, ExpiresIn))
        return "https://example.invalid/download"


class ManuscriptExportServiceTests(unittest.TestCase):
    @patch("app.services.manuscript_exports.record_successful_export")
    @patch("app.services.manuscript_exports.put_bytes")
    @patch("app.services.manuscript_exports._workspace_for_owner")
    @patch("app.services.manuscript_exports.BUCKET_NAME", "private-test-bucket")
    def test_export_uploads_file_then_records_success(
        self, workspace_lookup, put_file, record_export
    ):
        workspace_lookup.return_value = {
            "manuscript_id": "manuscript-1",
            "current_version_id": "version-1",
            "title": "A Scoping Review",
            "article_type": "scoping_review",
        }
        record_export.return_value = {
            "retention_phase": "post_export",
            "expires_at_iso": "2026-12-03T00:00:00+00:00",
        }
        s3 = FakeS3()
        result = manuscript_exports.export_current_version(
            "project-1",
            "owner-1",
            "docx",
            table=FakeTable(),
            storage_client=s3,
            now=datetime(2026, 11, 19, tzinfo=timezone.utc),
        )

        self.assertEqual(result["status"], "exported")
        self.assertEqual(result["format"], "docx")
        self.assertTrue(result["object_key"].endswith(".docx"))
        self.assertEqual(result["download_url"], "https://example.invalid/download")
        put_file.assert_called_once()
        record_export.assert_called_once()
        self.assertEqual(record_export.call_args.kwargs["export_format"], "docx")

    @patch("app.services.manuscript_exports.record_successful_export")
    @patch("app.services.manuscript_exports.put_bytes", side_effect=HTTPException(500, "upload failed"))
    @patch("app.services.manuscript_exports._workspace_for_owner")
    def test_failed_upload_does_not_start_post_export_retention(
        self, workspace_lookup, put_file, record_export
    ):
        workspace_lookup.return_value = {
            "manuscript_id": "manuscript-1",
            "current_version_id": "version-1",
            "title": "A Scoping Review",
            "article_type": "scoping_review",
        }
        with self.assertRaises(HTTPException):
            manuscript_exports.export_current_version(
                "project-1", "owner-1", "pdf", table=FakeTable(), storage_client=FakeS3()
            )
        record_export.assert_not_called()


if __name__ == "__main__":
    unittest.main()
