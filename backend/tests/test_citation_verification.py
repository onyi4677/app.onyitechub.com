import unittest
from unittest.mock import patch

from app.services.citation_verification import _is_public_http_url, verify_citations_and_references


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

    @patch("app.services.citation_verification._registry_lookup")
    def test_doi_title_and_author_mismatch_is_not_verified(self, registry_lookup):
        registry_lookup.return_value = {
            "status": "found",
            "registry": "crossref",
            "doi": "10.1234/example",
            "title": "A completely different paper",
            "authors": ["Other"],
            "year": "2021",
        }
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). A relevant research article. Journal of Testing. https://doi.org/10.1234/example
"""
        result = verify_citations_and_references(manuscript, check_external=True)
        self.assertEqual(result["doi_checks"][0]["metadata_comparison"], "metadata_mismatch")
        self.assertIn(
            "reference.doi_metadata_mismatch",
            {finding["rule_id"] for finding in result["findings"]},
        )

    @patch("app.services.citation_verification._check_url")
    def test_reference_url_accessibility_is_included_in_report(self, check_url):
        check_url.return_value = {
            "status": "accessible",
            "http_status": 200,
            "final_url": "https://example.org/article",
        }
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). A relevant research article. Journal of Testing. https://example.org/article
"""
        result = verify_citations_and_references(manuscript, check_external=True)
        self.assertEqual(result["url_checks"][0]["status"], "accessible")
        self.assertEqual(result["summary"]["url_checked_count"], 1)
        check_url.assert_called_once_with("https://example.org/article")

    def test_private_or_local_url_is_rejected_before_request(self):
        self.assertFalse(_is_public_http_url("http://127.0.0.1/admin"))
        self.assertFalse(_is_public_http_url("http://localhost/private"))

    @patch("app.services.citation_verification._registry_lookup")
    def test_uses_datacite_when_crossref_does_not_have_doi(self, registry_lookup):
        registry_lookup.side_effect = [
            {"status": "not_found", "registry": "crossref"},
            {
                "status": "found",
                "registry": "datacite",
                "doi": "10.1234/example",
                "title": "A relevant research article",
                "authors": ["Smith"],
                "year": "2021",
            },
        ]
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). A relevant research article. Journal of Testing. https://doi.org/10.1234/example
"""
        result = verify_citations_and_references(manuscript, check_external=True)
        self.assertEqual(result["doi_checks"][0]["registry_result"]["registry"], "datacite")
        self.assertEqual(result["doi_checks"][0]["metadata_comparison"], "verified")
        self.assertEqual(registry_lookup.call_count, 2)

    @patch("app.services.citation_verification._check_url")
    def test_http_error_url_is_reported_as_inaccessible_not_invalid_source(self, check_url):
        check_url.return_value = {"status": "inaccessible", "http_status": 404}
        manuscript = """Introduction
A prior study (Smith, 2021).

References
Smith, J. (2021). A relevant research article. Journal of Testing. https://example.org/missing
"""
        result = verify_citations_and_references(manuscript, check_external=True)
        finding = next(item for item in result["findings"] if item["rule_id"] == "reference.url_inaccessible")
        self.assertEqual(finding["status"], "inaccessible")
        self.assertIn("Confirm the link manually", finding["detail"])


if __name__ == "__main__":
    unittest.main()
