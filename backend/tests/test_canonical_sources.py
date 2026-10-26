import unittest

from app.services.canonical_sources import build_canonical_sources, canonical_source_id


class CanonicalSourcesTests(unittest.TestCase):
    def setUp(self):
        self.project = {
            "modules": {
                "literature_evidence": {
                    "sources": [
                        {
                            "source_id": "lit-1",
                            "authors": ["A. Author"],
                            "year": 2020,
                            "title": "Example Study",
                            "doi": "https://doi.org/10.1000/EXAMPLE",
                            "journal_or_publisher": "Journal",
                            "verified": True,
                        }
                    ],
                    "evidence_items": [{"evidence_id": "ev-1", "source_id": "lit-1"}],
                    "claims": [{"claim_id": "cl-1", "source_ids": ["lit-1"]}],
                },
                "references_citations": {
                    "references": [
                        {
                            "reference_id": "ref-1",
                            "authors": ["A. Author"],
                            "year": 2020,
                            "title": "Example Study",
                            "doi": "10.1000/example",
                            "journal_or_book": "Journal",
                        },
                        {
                            "reference_id": "ref-2",
                            "authors": ["B. Author"],
                            "year": 2022,
                            "title": "Reference-only Work",
                            "doi": "10.1000/OTHER",
                        },
                    ],
                    "in_text_citations": [
                        {"citation_id": "cit-1", "reference_ids": ["ref-1"]}
                    ],
                },
            }
        }

    def test_cross_module_duplicate_is_one_source_and_preserves_literature_id(self):
        sources = build_canonical_sources(self.project)
        self.assertEqual(len(sources), 2)
        example = next(s for s in sources if s["title"] == "Example Study")
        self.assertEqual(example["canonical_source_id"], "lit-1")
        self.assertIn("ref-1", example["aliases"])
        self.assertEqual(canonical_source_id(self.project, "ref-1"), "lit-1")
        self.assertEqual(self.project["modules"]["literature_evidence"]["evidence_items"][0]["source_id"], "lit-1")
        self.assertEqual(self.project["modules"]["references_citations"]["in_text_citations"][0]["reference_ids"], ["ref-1"])

    def test_reference_only_work_is_available_without_copying_it(self):
        sources = build_canonical_sources(self.project)
        item = next(s for s in sources if s["title"] == "Reference-only Work")
        self.assertEqual(item["canonical_source_id"], "ref-2")
        self.assertEqual(canonical_source_id(self.project, "ref-2"), "ref-2")
        self.assertEqual(len(self.project["modules"]["literature_evidence"]["sources"]), 1)

    def test_duplicate_legacy_literature_ids_remain_aliases(self):
        self.project["modules"]["literature_evidence"]["sources"].append({
            "source_id": "lit-duplicate",
            "authors": ["A. Author"],
            "year": 2020,
            "title": "Example Study",
            "doi": "10.1000/example",
        })
        sources = build_canonical_sources(self.project)
        example = next(s for s in sources if s["title"] == "Example Study")
        self.assertEqual(example["canonical_source_id"], "lit-1")
        self.assertIn("lit-duplicate", example["aliases"])
        self.assertEqual(canonical_source_id(self.project, "lit-duplicate"), "lit-1")


if __name__ == "__main__":
    unittest.main()
