import io
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from botocore.exceptions import ClientError

from docx import Document
from pypdf import PdfWriter

from app.services import integrity_extraction as extraction
from app.services import integrity_submissions as submissions
from app.services.integrity_extraction import (
    _extract_docx,
    _extract_pdf,
    extract_and_check_submission,
)
from app.services.integrity_submissions import SubmissionExpiredError, SubmissionValidationError


class FakeBody:
    def __init__(self, value):
        self.value = value

    def read(self):
        return self.value


class FakeTable:
    def __init__(self, item):
        self.item = item
        self.updates = []
        self.update_error = None

    def get_item(self, **kwargs):
        if kwargs["Key"]["owner_sub"] != self.item["owner_sub"]:
            return {}
        return {"Item": self.item}

    def update_item(self, **kwargs):
        self.updates.append(kwargs)
        expression = kwargs.get("UpdateExpression", "")
        if self.update_error and expression.startswith("SET #status = :status"):
            raise self.update_error
        values = kwargs.get("ExpressionAttributeValues", {})
        if "processing_lease_token" in expression and ":token" in values:
            self.item["processing_lease_token"] = values[":token"]
            self.item["processing_lease_until"] = values.get(":until")
        if expression.startswith("REMOVE processing_lease_token"):
            self.item.pop("processing_lease_token", None)
            self.item.pop("processing_lease_until", None)


class FakeS3:
    def __init__(self, payload):
        self.payload = payload
        self.puts = []
        self.deleted = []

    def get_object(self, **kwargs):
        return {"Body": FakeBody(self.payload)}

    def put_object(self, **kwargs):
        self.puts.append(kwargs)

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs)


def make_docx():
    document = Document()
    document.add_heading("Abstract", level=1)
    document.add_paragraph("A sample manuscript abstract.")
    document.add_heading("Methods", level=1)
    document.add_paragraph("A cross-sectional survey was conducted.")
    document.add_heading("References", level=1)
    document.add_paragraph("Smith, J. (2021). A sample reference. Journal.")
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def make_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=300)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class ManuscriptExtractionTests(unittest.TestCase):
    def test_extracts_docx_paragraphs(self):
        text = _extract_docx(make_docx())
        self.assertIn("A sample manuscript abstract.", text)
        self.assertIn("A cross-sectional survey was conducted.", text)

    def test_preserves_table_position_between_paragraphs(self):
        document = Document()
        document.add_paragraph("Before the table.")
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "Table value A"
        table.cell(0, 1).text = "Table value B"
        document.add_paragraph("After the table.")
        buffer = io.BytesIO()
        document.save(buffer)

        text = _extract_docx(buffer.getvalue())

        self.assertLess(text.index("Before the table."), text.index("Table value A"))
        self.assertLess(text.index("Table value A"), text.index("After the table."))
        self.assertIn("Table value A | Table value B", text)

    def test_rejects_invalid_docx_archive(self):
        with self.assertRaises(SubmissionValidationError):
            _extract_docx(b"not a docx")

    def test_rejects_invalid_pdf_signature(self):
        with self.assertRaises(SubmissionValidationError):
            _extract_pdf(b"not a pdf")

    def test_extracts_pdf_without_crashing_on_empty_text_page(self):
        text = _extract_pdf(make_pdf())
        self.assertEqual(text, "")

    def test_extraction_stores_text_in_s3_and_report_in_owner_record(self):
        payload = make_docx()
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-1",
            "file_name": "paper.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "expected_size_bytes": len(payload),
            "object_key": "submissions/user-a/submission-1/original.docx",
            "status": "uploaded",
            "created_at": "2026-11-03T10:00:00+00:00",
            "expires_at": int(datetime.now(timezone.utc).timestamp()) + 2000,
            "cleanup_status": "pending",
            "cleanup_at": int(datetime.now(timezone.utc).timestamp()) + 1700,
            "content_retention_status": "available",
        }
        table = FakeTable(item)
        s3 = FakeS3(payload)
        with patch.object(extraction, "_resources", return_value=(s3, table, "private-bucket")), patch.object(
            submissions, "_resources", return_value=(s3, table, "private-bucket")
        ):
            result = extract_and_check_submission("user-a", "submission-1")

        self.assertEqual(result["submission"]["status"], "extraction_completed")
        self.assertEqual(result["extraction"]["status"], "text_extracted")
        self.assertIn("cleanup_status = :cleanup_pending", table.updates[0]["ConditionExpression"])
        self.assertIn(b"A sample manuscript abstract.", s3.puts[0]["Body"])
        self.assertEqual(s3.puts[0]["ServerSideEncryption"], "AES256")
        self.assertNotIn("full_text", table.updates[0]["ExpressionAttributeValues"][":report"])

    def test_other_owner_cannot_extract_submission(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-1",
            "status": "uploaded",
        }
        table = FakeTable(item)
        s3 = FakeS3(b"")
        with patch.object(extraction, "_resources", return_value=(s3, table, "private-bucket")), patch.object(
            submissions, "_resources", return_value=(s3, table, "private-bucket")
        ):
            with self.assertRaises(Exception):
                extract_and_check_submission("user-b", "submission-1")
        self.assertEqual(s3.puts, [])

    def test_expired_submission_cannot_start_extraction(self):
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-expired",
            "status": "expired",
            "content_retention_status": "expired",
            "cleanup_status": "pending",
            "cleanup_at": 100,
            "expires_at": 400,
        }
        table = FakeTable(item)
        s3 = FakeS3(b"")
        with patch.object(extraction, "_resources", return_value=(s3, table, "private-bucket")), patch.object(
            submissions, "_resources", return_value=(s3, table, "private-bucket")
        ):
            with self.assertRaises(SubmissionExpiredError):
                extract_and_check_submission("user-a", "submission-expired")
        self.assertEqual(s3.puts, [])

    def test_saved_report_remains_available_after_content_expiry(self):
        report = {"word_count": 123, "findings": []}
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-retained",
            "file_name": "paper.pdf",
            "content_type": "application/pdf",
            "expected_size_bytes": 100,
            "object_key": "submissions/user-a/submission-retained/original.pdf",
            "status": "extraction_completed",
            "created_at": "2026-11-03T10:00:00+00:00",
            "updated_at": "2026-11-03T10:01:00+00:00",
            "deterministic_report": report,
            "extraction": {"status": "text_extracted"},
            "content_retention_status": "expired",
        }
        table = FakeTable(item)
        s3 = FakeS3(b"")
        with patch.object(extraction, "_resources", return_value=(s3, table, "private-bucket")):
            result = extract_and_check_submission("user-a", "submission-retained")
        self.assertTrue(result["already_processed"])
        self.assertEqual(result["report"], report)
        self.assertEqual(s3.puts, [])

    def test_failed_conditional_save_removes_derived_object(self):
        payload = make_docx()
        item = {
            "owner_sub": "user-a",
            "submission_id": "submission-race",
            "file_name": "paper.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "expected_size_bytes": len(payload),
            "object_key": "submissions/user-a/submission-race/original.docx",
            "status": "uploaded",
            "created_at": "2026-11-03T10:00:00+00:00",
            "expires_at": int(datetime.now(timezone.utc).timestamp()) + 2000,
            "cleanup_status": "pending",
            "cleanup_at": int(datetime.now(timezone.utc).timestamp()) + 1700,
        }
        table = FakeTable(item)
        table.update_error = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": "expired"}},
            "UpdateItem",
        )
        s3 = FakeS3(payload)
        with patch.object(extraction, "_resources", return_value=(s3, table, "private-bucket")), patch.object(
            submissions, "_resources", return_value=(s3, table, "private-bucket")
        ):
            with self.assertRaises(SubmissionExpiredError):
                extract_and_check_submission("user-a", "submission-race")
        self.assertEqual(s3.deleted[0]["Key"], "submissions/user-a/submission-race/derived/extracted.txt")


if __name__ == "__main__":
    unittest.main()
