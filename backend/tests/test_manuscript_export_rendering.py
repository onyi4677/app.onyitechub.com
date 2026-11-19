import unittest
from datetime import datetime, timezone
from io import BytesIO
from zipfile import ZipFile

from app.services.manuscript_export_rendering import render_docx, render_pdf


class ManuscriptExportRenderingTests(unittest.TestCase):
    def setUp(self):
        self.sections = [
            {
                "section_id": "methods",
                "title": "Methods",
                "order": 2,
                "content": "First paragraph.\n\nSecond paragraph.",
            },
            {
                "section_id": "abstract",
                "title": "Abstract",
                "order": 1,
                "content": "A concise abstract.",
            },
        ]
        self.generated_at = datetime(2026, 11, 19, tzinfo=timezone.utc)

    def test_docx_contains_title_and_sections_in_order(self):
        data = render_docx(
            "A Review", self.sections, "Project 001", "scoping_review",
            generated_at=self.generated_at,
        )
        with ZipFile(BytesIO(data)) as archive:
            document_xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("A Review", document_xml)
        self.assertIn("Abstract", document_xml)
        self.assertIn("Methods", document_xml)
        self.assertLess(document_xml.index("Abstract"), document_xml.index("Methods"))
        self.assertIn("First paragraph.", document_xml)
        self.assertIn("WORKING DRAFT", document_xml)

    def test_pdf_is_valid_pdf_and_contains_manuscript_text(self):
        data = render_pdf(
            "A Review", self.sections, "Project 001", "scoping_review",
            generated_at=self.generated_at,
        )
        self.assertTrue(data.startswith(b"%PDF-"))
        self.assertGreater(len(data), 500)
        from pypdf import PdfReader
        pdf_text = "\\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)
        self.assertIn("WORKING DRAFT", pdf_text)

    def test_rejects_duplicate_or_invalid_section_ids(self):
        invalid = [self.sections[0], dict(self.sections[0])]
        with self.assertRaises(ValueError):
            render_docx("A Review", invalid)
        with self.assertRaises(ValueError):
            render_pdf("", self.sections)

    def test_empty_section_is_explicitly_marked(self):
        data = render_docx(
            "A Review",
            [{"section_id": "intro", "title": "Introduction", "content": ""}],
            generated_at=self.generated_at,
        )
        with ZipFile(BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("[Section not yet drafted]", xml)


if __name__ == "__main__":
    unittest.main()
