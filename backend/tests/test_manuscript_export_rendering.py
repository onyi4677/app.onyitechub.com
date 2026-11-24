import unittest
from datetime import datetime, timezone
from io import BytesIO
from docx.shared import Inches
from zipfile import ZipFile

from app.services.manuscript_export_rendering import render_docx, render_pdf


class ManuscriptExportRenderingTests(unittest.TestCase):
    def setUp(self):
        self.sections = [
            {
                "section_id": "methods",
                "title": "Methods",
                "order": 2,
                "content": "First paragraph.\\n\\nSecond paragraph.",
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

    def test_html_table_becomes_native_docx_table(self):
        sections = [{
            "section_id": "results", "title": "Results", "order": 1, "status": "draft",
            "content": '<p>Intro paragraph.</p><table><tr><th>Study</th><th>Location</th></tr><tr><td>Ibrahim et al. (2023)</td><td>Yobe</td></tr><tr><td>Agu et al. (2022)</td><td>Taraba</td></tr></table>',
        }]
        from docx import Document
        document = Document(BytesIO(render_docx("HTML table", sections)))
        self.assertEqual(len(document.tables), 1)
        self.assertEqual(len(document.tables[0].rows), 3)
        self.assertEqual(len(document.tables[0].columns), 2)
        self.assertEqual(document.tables[0].cell(1, 0).text, "Ibrahim et al. (2023)")
        self.assertEqual(document.tables[0].cell(2, 1).text, "Taraba")

    def test_markdown_table_becomes_native_docx_table(self):
        sections = [{
            "section_id": "results", "title": "Results", "order": 1, "status": "draft",
            "content": "| Study | Location |\\n|---|---|\\n| Ibrahim et al. (2023) | Yobe |\\n| Agu et al. (2022) | Taraba |",
        }]
        from docx import Document
        document = Document(BytesIO(render_docx("Markdown table", sections)))
        self.assertEqual(len(document.tables), 1)
        self.assertEqual(document.tables[0].cell(2, 0).text, "Agu et al. (2022)")

    def test_tab_separated_five_column_table_becomes_landscape_native_docx_table(self):
        content = (
            "Study\\tTrauma or psychological assessment\\tPTSD-related findings\\tOther reported findings\\tInterpretation and limitations\\n"
            "Ibrahim et al. (2023)\\tHarvard Trauma Questionnaire (HTQ)\\t424 of 450 participants (94.2%) exceeded threshold.\\t443 of 450 (98.4%) exceeded depression threshold.\\tQuestionnaire estimates, not clinician-confirmed diagnoses.\\n"
            "Agu et al. (2022)\\tNSESSS; DASS\\tAuthors reported reduced PTSD symptoms after CBT.\\t12 sessions over 13 weeks.\\tGroup-specific counts require verification.\\n"
            "Note. Findings are extracted and are not pooled estimates."
        )
        sections = [{
            "section_id": "results", "title": "Results", "order": 1,
            "status": "draft", "content": content,
        }]
        from docx import Document
        document = Document(BytesIO(render_docx("Table export", sections)))
        self.assertEqual(len(document.tables), 1)
        self.assertEqual(len(document.tables[0].columns), 5)
        self.assertEqual(len(document.tables[0].rows), 3)
        self.assertEqual(document.tables[0].cell(0, 0).text, "Study")
        self.assertEqual(document.tables[0].cell(1, 0).text, "Ibrahim et al. (2023)")
        self.assertEqual(document.sections[0].page_width, Inches(11))
        self.assertIn("Note. Findings are extracted", "\\n".join(p.text for p in document.paragraphs))

    def test_five_column_tab_table_uses_landscape_pdf_page(self):
        content = (
            "Study\\tAssessment\\tPTSD findings\\tOther findings\\tLimitations\\n"
            "Ibrahim et al. (2023)\\tHTQ\\tHigh symptom estimate.\\tDepression symptoms.\\tNot a clinical diagnosis."
        )
        sections = [{
            "section_id": "results", "title": "Results", "order": 1,
            "status": "draft", "content": content,
        }]
        from pypdf import PdfReader
        pdf = PdfReader(BytesIO(render_pdf("Wide table", sections)))
        self.assertAlmostEqual(float(pdf.pages[0].mediabox.width), 841.89, places=1)
        text = " ".join("\\n".join(page.extract_text() or "" for page in pdf.pages).split())
        self.assertIn("Ibrahim et al. (2023)", text)
        self.assertIn("Not a clinical diagnosis.", text)

    def test_pdf_table_text_remains_extractable(self):
        sections = [{
            "section_id": "results", "title": "Results", "order": 1, "status": "draft",
            "content": '<table><tr><th>Study</th><th>Location</th></tr><tr><td>Ibrahim et al. (2023)</td><td>Yobe</td></tr></table>',
        }]
        from pypdf import PdfReader
        pdf = PdfReader(BytesIO(render_pdf("PDF table", sections)))
        text = "\\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertIn("Ibrahim et al. (2023)", text)
        self.assertIn("Yobe", text)

    def test_duplicate_results_tail_is_omitted_from_methods_export_only(self):
        sections = [
            {
                "section_id": "methods", "title": "Methods", "order": 2,
                "content": (
                    "<p>Eligibility criteria were applied.</p>"
                    "<p>Studies failing the criteria were excluded.</p>"
                    "<h2>3. Results</h2>"
                    "<p>3.1 Study selection</p>"
                    "<table><tr><th>Study</th><th>Finding</th></tr>"
                    "<tr><td>Repeated study</td><td>Repeated finding</td></tr></table>"
                ),
            },
            {
                "section_id": "results", "title": "Results", "order": 3,
                "content": (
                    "<p>3.1 Study selection</p>"
                    "<table><tr><th>Study</th><th>Finding</th></tr>"
                    "<tr><td>Repeated study</td><td>Repeated finding</td></tr></table>"
                ),
            },
        ]
        from docx import Document
        document = Document(BytesIO(render_docx("Duplicate test", sections)))
        self.assertEqual(len(document.tables), 1)
        paragraphs = "\\n".join(p.text for p in document.paragraphs)
        self.assertIn("Eligibility criteria were applied.", paragraphs)
        self.assertIn("Studies failing the criteria were excluded.", paragraphs)
        self.assertNotIn("3. Results", paragraphs)
        # The input records remain unchanged; only the export representation is filtered.
        self.assertIn("<h2>3. Results</h2>", sections[0]["content"])
        self.assertEqual(sections[0]["content"].count("<table>"), 1)

    def test_duplicate_results_tail_is_kept_when_no_results_section_exists(self):
        sections = [{
            "section_id": "methods", "title": "Methods", "order": 1,
            "content": "Methods text.\\n3. Results\\nResults text that is not duplicated.",
        }]
        from docx import Document
        document = Document(BytesIO(render_docx("No duplicate", sections)))
        text = "\\n".join(p.text for p in document.paragraphs)
        self.assertIn("3. Results", text)
        self.assertIn("Results text that is not duplicated.", text)


if __name__ == "__main__":
    unittest.main()
