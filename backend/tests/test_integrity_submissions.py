import unittest
from unittest.mock import patch

from app.services.integrity_submissions import (
    MAX_FILE_BYTES,
    SubmissionValidationError,
    validate_upload,
)


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


if __name__ == "__main__":
    unittest.main()
