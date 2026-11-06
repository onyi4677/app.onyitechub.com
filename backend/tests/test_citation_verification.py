import unittest
from unittest.mock import patch

from app.services.citation_verification import verify_citations_and_references


class CitationVerificationTests(unittest.TestCase):
    def test_matches_parenthetical_and_narrative_author_year_citations(self):
        manuscript = """Title

Introduction
Prior work supports this finding (Smith, 2021; Jones et al., 2020).
Smith (2021) also discussed this issue.

References
Smith, J. (2021). A relevant research article. Journal of Testing, 4(2), 1-9.
Jones, A., Brown, B., & Green, C. (2020). Another research article. Research Review, 8(1), 10-20.
"""
        result = verify_citations_and_references(manuscript, check_external=False)
        self.assertEqual(result["citation_count"], 3)
        self.assertEqual(result["parsed_reference_count"], 2)
        self.assertEqual(result["summary"]["unmatched_citation_count"], 0)
        self.assertEqual(result["summary"]["uncited_reference_count"], 0)

    def test_reports_citation_without_reference_and_uncited_reference(self):
        manuscript = """Introduction
This was previously reported (Missing, 2019).

References
Unused, U. (2022). An unused source. Journal of Examples.
"""
        result = verify_citations_and_references(manuscript, check_external=False)
        rule_ids = {finding["rule_id"] for finding in result["findings"]}
        self.assertIn("citation.reference_missing", rule_ids)
        self.assertIn("reference.not_cited", rule_ids)

    def test_detects_same_author_year_reference_collision(self):
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). First title. Journal One.
Smith, J. (2021). Second title. Journal Two.
"""
        result = verify_citations_and_references(manuscript, check_external=False)
        self.assertIn(
            "reference.possible_duplicate",
            {finding["rule_id"] for finding in result["findings"]},
        )

    @patch("app.services.citation_verification._registry_lookup")
    def test_crossref_metadata_match_is_reported_as_verified(self, registry_lookup):
        registry_lookup.return_value = {
            "status": "found",
            "registry": "crossref",
            "doi": "10.1234/example",
            "title": "A relevant research article",
            "authors": ["Smith"],
            "year": "2021",
            "container_title": "Journal of Testing",
        }
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). A relevant research article. Journal of Testing. https://doi.org/10.1234/example
"""
        result = verify_citations_and_references(manuscript, check_external=True)
        self.assertEqual(len(result["doi_checks"]), 1)
        self.assertEqual(result["doi_checks"][0]["metadata_comparison"], "verified")

    def test_empty_manuscript_is_not_reported_as_verified(self):
        result = verify_citations_and_references("  ", check_external=False)
        self.assertEqual(result["status"], "not_assessed")
        self.assertEqual(result["citation_count"], 0)


if __name__ == "__main__":
    unittest.main()
