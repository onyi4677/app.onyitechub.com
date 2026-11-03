import unittest

from app.services.integrity_checks import run_deterministic_checks


class IntegrityChecksTests(unittest.TestCase):
    def test_empty_extraction_is_not_reported_as_a_clean_manuscript(self):
        result = run_deterministic_checks("  ")
        self.assertEqual(result["status"], "needs_attention")
        self.assertEqual(result["word_count"], 0)
        self.assertEqual(result["findings"][0]["rule_id"], "document.empty_extraction")

    def test_detects_common_sections_and_reports_metrics(self):
        text = """Title of the Study

Abstract
This is an abstract.

Introduction
Background text (Smith, 2021).

Methods
A cross-sectional design was used.

Results
Results are reported.

Discussion
Interpretation.

Conclusion
Summary.

References
Smith, J. (2021). Example title. Journal.
"""
        result = run_deterministic_checks(text)
        self.assertIn("abstract", result["detected_sections"])
        self.assertIn("methods", result["detected_sections"])
        self.assertIn("references", result["detected_sections"])
        self.assertGreater(result["word_count"], 20)
        self.assertEqual(result["citation_pattern_count"], 1)

    def test_flags_placeholder_and_duplicate_reference_line(self):
        duplicate = "Smith, J. (2021). Example reference title. Journal."
        text = f"""Abstract
Text.

Methods
Text.

References
{duplicate}
{duplicate}
Please insert citation here.\n[INSERT AUTHOR]
"""
        result = run_deterministic_checks(text)
        rule_ids = {finding["rule_id"] for finding in result["findings"]}
        self.assertIn("content.placeholder_text", rule_ids)
        self.assertIn("references.exact_duplicate_line", rule_ids)

    def test_never_claims_to_detect_plagiarism(self):
        result = run_deterministic_checks("Abstract\nSome original-looking text.")
        self.assertTrue(any("do not detect plagiarism" in item.lower() for item in result["limitations"]))


if __name__ == "__main__":
    unittest.main()
