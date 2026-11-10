import unittest

from app.services.integrity_ai_review import _enforce_deterministic_citation_findings


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


if __name__ == "__main__":
    unittest.main()
