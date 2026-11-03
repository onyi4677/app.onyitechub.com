import unittest
from unittest.mock import patch

from app.services import integrity_submissions as submissions
from app.services.integrity_submissions import (
    MAX_FILE_BYTES,
    SubmissionExpiredError,
    SubmissionNotFoundError,
    SubmissionValidationError,
    cleanup_expired_submissions,
    create_submission,
    complete_submission,
    delete_submission,
    get_submission,
    validate_upload,
)


class FakeTable:
    def __init__(self, item=None):
        self.item = item
        self.put_calls = []
        self.update_calls = []
        self.delete_calls = []
        self.query_items = []
        self.query_calls = []

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        return {"Items": self.query_items}

    def put_item(self, **kwargs):
        self.put_calls.append(kwargs)

    def get_item(self, **kwargs):
        return {"Item": self.item} if self.item else {}

    def update_item(self, **kwargs):
        self.update_calls.append(kwargs)

    def delete_item(self, **kwargs):
        self.delete_calls.append(kwargs)


class FakeS3:
    def __init__(self, head=None):
        self.head = head or {"ContentLength": 1024, "ContentType": "application/pdf"}
        self.presign_args = None
        self.deleted = []

    def generate_presigned_post(self, **kwargs):
        self.presign_args = kwargs
        return {"url": "https://upload.example.test", "fields": {"key": kwargs["Key"]}}

    def head_object(self, **kwargs):
        return self.head

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs)


class IntegritySubmissionValidationTests(unittest.TestCase):
    def test_accepts_pdf_and_docx(self):
        self.assertEqual(
            validate_upload("manuscript.pdf", "application/pdf", 1024),
            "manuscript.pdf",
        )
        self.assertEqual(
            validate_upload(
                "paper.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                1024,
            ),
            "paper.docx",
        )

    def test_rejects_mismatched_extension_and_content_type(self):
        with self.assertRaises(SubmissionValidationError):
            validate_upload("paper.pdf", "text/plain", 1024)

    def test_rejects_unsupported_file_types(self):
        with self.assertRaises(SubmissionValidationError):
            validate_upload("paper.doc", "application/msword", 1024)

    def test_rejects_empty_and_oversized_files(self):
        with self.assertRaises(SubmissionValidationError):
            validate_upload("paper.pdf", "application/pdf", 0)
        with self.assertRaises(SubmissionValidationError):
            validate_upload("paper.pdf", "application/pdf", MAX_FILE_BYTES + 1)

    def test_reduces_path_to_safe_filename(self):
        self.assertEqual(
            validate_upload("../../paper.pdf", "application/pdf", 10),
            "paper.pdf",
        )

    def test_rejects_empty_filename(self):
        with self.assertRaises(SubmissionValidationError):
            validate_upload("../", "application/pdf", 10)

    def test_permission_confirmation_is_required_before_storage(self):
        with patch.object(submissions, "_resources") as resources:
            with self.assertRaises(SubmissionValidationError):
                create_submission("user-a", "paper.pdf", "application/pdf", 1024, False)
            resources.assert_not_called()

    def test_create_submission_is_owner_scoped_and_uses_bounded_presigned_post(self):
        table = FakeTable()
        s3 = FakeS3()
        with patch.object(submissions, "_resources", return_value=(s3, table, "private-bucket")):
            result = create_submission("user-a", "paper.pdf", "application/pdf", 1024, True)

        item = table.put_calls[0]["Item"]
        self.assertEqual(item["owner_sub"], "user-a")
        self.assertEqual(item["status"], "pending_upload")
        self.assertEqual(item["cleanup_status"], "pending")
        self.assertEqual(item["expires_at"] - item["cleanup_at"], 300)
        self.assertEqual(result["submission"]["content_retention_status"] if "content_retention_status" in result["submission"] else "available", "available")
        self.assertTrue(item["object_key"].startswith("submissions/user-a/"))
        self.assertEqual(result["upload_expires_in_seconds"], 300)
        self.assertIn(["content-length-range", 1, MAX_FILE_BYTES], s3.presign_args["Conditions"])

    def test_complete_submission_checks_object_metadata_and_sets_uploaded(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-1",
            "file_name": "paper.pdf",
            "content_type": "application/pdf",
            "expected_size_bytes": 1024,
            "object_key": "submissions/user-a/submission-1/original.pdf",
            "status": "pending_upload",
            "created_at": "2026-11-03T10:00:00+00:00",
            "expires_at": 2000,
            "cleanup_status": "pending",
            "cleanup_at": 1700,
            "content_retention_status": "available",
        }
        table = FakeTable(item)
        s3 = FakeS3()
        with patch.object(submissions, "_resources", return_value=(s3, table, "private-bucket")), patch.object(submissions, "_now_epoch", return_value=1000):
            result = complete_submission("user-a", "submission-1")

        self.assertEqual(result["status"], "uploaded")
        self.assertEqual(table.update_calls[0]["Key"]["owner_sub"], "user-a")

    def test_other_owner_cannot_read_submission(self):
        table = FakeTable()
        with patch.object(submissions, "_resources", return_value=(FakeS3(), table, "private-bucket")):
            with self.assertRaises(SubmissionNotFoundError):
                get_submission("user-b", "submission-1")

    def test_delete_removes_only_owner_scoped_object_and_record(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-1",
            "file_name": "paper.pdf",
            "content_type": "application/pdf",
            "expected_size_bytes": 1024,
            "object_key": "submissions/user-a/submission-1/original.pdf",
            "extracted_key": "submissions/user-a/submission-1/derived/extracted.txt",
            "status": "uploaded",
            "created_at": "2026-11-03T10:00:00+00:00",
        }
        table = FakeTable(item)
        s3 = FakeS3()
        with patch.object(submissions, "_resources", return_value=(s3, table, "private-bucket")):
            delete_submission("user-a", "submission-1")

        self.assertEqual(s3.deleted[0]["Key"], item["object_key"])
        self.assertEqual(s3.deleted[1]["Key"], item["extracted_key"])
        self.assertEqual(table.delete_calls[0]["Key"]["owner_sub"], "user-a")

    def test_cleanup_deletes_manuscript_objects_but_retains_report_record(self):
        report = {"word_count": 250, "findings": []}
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-1",
            "file_name": "paper.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "expected_size_bytes": 1024,
            "object_key": "submissions/user-a/submission-1/original.docx",
            "extracted_key": "submissions/user-a/submission-1/derived/extracted.txt",
            "status": "extraction_completed",
            "created_at": "2026-11-03T10:00:00+00:00",
            "expires_at": 2000,
            "cleanup_status": "pending",
            "cleanup_at": 1700,
            "deterministic_report": report,
        }
        table = FakeTable(item)
        table.query_items = [item]
        s3 = FakeS3()
        with patch.object(submissions, "_resources", return_value=(s3, table, "private-bucket")):
            result = cleanup_expired_submissions(now_epoch=1800)

        self.assertEqual(result, {"checked": 1, "cleaned": 1, "failed": 0})
        self.assertEqual([call["Key"] for call in s3.deleted], [item["object_key"], item["extracted_key"]])
        update = table.update_calls[0]
        self.assertIn("REMOVE cleanup_status, cleanup_at", update["UpdateExpression"])
        self.assertIn("cleanup_status = :pending", update["ConditionExpression"])
        self.assertEqual(item["deterministic_report"], report)

    def test_cleanup_failure_leaves_record_eligible_for_retry(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-2",
            "object_key": "submissions/user-a/submission-2/original.pdf",
            "status": "uploaded",
            "cleanup_status": "pending",
            "cleanup_at": 1700,
        }

        class FailingS3(FakeS3):
            def delete_object(self, **kwargs):
                raise RuntimeError("simulated S3 failure")

        table = FakeTable(item)
        table.query_items = [item]
        with patch.object(submissions, "_resources", return_value=(FailingS3(), table, "private-bucket")):
            result = cleanup_expired_submissions(now_epoch=1800)

        self.assertEqual(result, {"checked": 1, "cleaned": 0, "failed": 1})
        self.assertEqual(table.update_calls, [])
        self.assertEqual(item["cleanup_status"], "pending")

    def test_expired_submission_is_rejected_for_new_processing(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-3",
            "file_name": "paper.pdf",
            "content_type": "application/pdf",
            "expected_size_bytes": 1024,
            "object_key": "submissions/user-a/submission-3/original.pdf",
            "status": "uploaded",
            "created_at": "2026-11-03T10:00:00+00:00",
            "cleanup_status": "pending",
            "cleanup_at": 100,
            "expires_at": 400,
        }
        table = FakeTable(item)
        with patch.object(submissions, "_resources", return_value=(FakeS3(), table, "private-bucket")), patch.object(submissions, "_now_epoch", return_value=101):
            with self.assertRaises(SubmissionExpiredError):
                complete_submission("user-a", "submission-3")


if __name__ == "__main__":
    unittest.main()
