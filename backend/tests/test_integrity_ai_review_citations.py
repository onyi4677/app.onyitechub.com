import unittest

from app.services.integrity_ai_review import (
    MAX_AI_REVIEW_CHARS,
    _enforce_deterministic_citation_findings,
    _split_manuscript_into_sections,
)


class DeterministicCitationFindingTests(unittest.TestCase):
    def test_drops_ai_citation_claims_not_confirmed_by_deterministic_evidence(self):
        report = {
            "findings": [
                {"category": "citation", "excerpt": "(Federal Ministry, 2025; Vanguard News, 2026)"},
                {"category": "citation", "excerpt": "(Vanguard News, 2026)"},
                {"category": "clarity", "excerpt": "A sentence from the manuscript."},
            ],
            "limitations": [],
        }
        evidence = {
            "findings": [
                {
                    "rule_id": "citation.reference_missing",
                    "citation": "(Vanguard News, 2026)",
                }
            ]
        }

        result = _enforce_deterministic_citation_findings(report, evidence)

        self.assertEqual(
            [item["excerpt"] for item in result["findings"]],
            ["(Vanguard News, 2026)", "A sentence from the manuscript."],
        )
        self.assertTrue(any("omitted" in item for item in result["limitations"]))

    def test_drops_all_ai_citation_claims_when_deterministic_check_finds_none(self):
        report = {
            "findings": [{"category": "citation", "excerpt": "(Invented, 2020)"}],
            "limitations": [],
        }

        result = _enforce_deterministic_citation_findings(report, {"findings": []})

        self.assertEqual(result["findings"], [])
        self.assertTrue(result["limitations"])


    def test_ai_review_limit_is_150000_characters(self):
        self.assertEqual(MAX_AI_REVIEW_CHARS, 150_000)

    def test_long_manuscript_is_split_without_losing_paragraph_content(self):
        manuscript = (
            "ABSTRACT\\nSummary paragraph.\\n"
            "1. INTRODUCTION\\n" + ("Introduction text. " * 1_400) + "\\n"
            "2. METHODOLOGY\\n" + ("Methods text. " * 1_400) + "\\n"
            "REFERENCES\\n" + ("Reference entry. " * 1_400)
        )
        chunks = _split_manuscript_into_sections(manuscript, max_chars=10_000)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk["text"]) <= 10_000 for chunk in chunks))
        combined = "\\n".join(chunk["text"] for chunk in chunks)
        for required in (
            "Summary paragraph.",
            "1. INTRODUCTION",
            "Introduction text.",
            "2. METHODOLOGY",
            "Methods text.",
            "REFERENCES",
            "Reference entry.",
        ):
            self.assertIn(required, combined)

    def test_section_aware_split_records_section_context(self):
        manuscript = (
            "INTRODUCTION\\n" + ("Introductory material. " * 300) + "\\n"
            "LITERATURE REVIEW\\n" + ("Literature material. " * 300)
        )
        chunks = _split_manuscript_into_sections(manuscript, max_chars=8_000)

        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["section"], "INTRODUCTION")
        self.assertTrue(any(chunk["section"] == "LITERATURE REVIEW" for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
