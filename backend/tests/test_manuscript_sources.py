import unittest

from app.services.manuscript_sources import collect_project_sources


class ManuscriptSourceCollectorTests(unittest.TestCase):
    def setUp(self):
        self.project = {
            "id": "project-1",
            "title": "Example review",
            "question": "What is known?",
            "discipline": "Psychology",
            "modules": {"legacy_marker": {"keep": True}},
        }
        self.modules = {
            "research_foundation": {"aim": "Map the evidence"},
            "literature_evidence": {
                "sources": [{
                    "source_id": "lit-1", "title": "Study A",
                    "authors": ["A. Author"], "year": 2022, "doi": "10.1000/a",
                }],
                "evidence_items": [{"evidence_id": "ev-1", "source_id": "lit-1"}],
            },
            "study_screening": {
                "records": [{"screening_id": "scr-1", "source_id": "lit-1"}],
                "evidence_extractions": [{"extraction_id": "ext-1"}],
            },
            "references_citations": {
                "references": [{
                    "reference_id": "ref-1", "title": "Study A",
                    "authors": ["A. Author"], "year": 2022, "doi": "10.1000/a",
                }],
                "in_text_citations": [{"citation_id": "cit-1", "reference_ids": ["ref-1"]}],
            },
            "methodology": {"review_type": "scoping"},
            "instruments": {"pathways": {"primary_data": {"instrument_versions": []}}},
        }

    def test_collects_all_source_modules_through_loader(self):
        calls = []

        def loader(project_id, module_key):
            calls.append((project_id, module_key))
            return self.modules[module_key]

        snapshot = collect_project_sources("project-1", self.project, loader)

        self.assertEqual([key for _, key in calls], [
            "research_foundation", "literature_evidence", "study_screening",
            "references_citations", "methodology", "instruments",
        ])
        self.assertEqual(snapshot["modules"]["study_screening"]["record_counts"]["records"], 1)
        self.assertEqual(snapshot["modules"]["literature_evidence"]["record_counts"]["sources"], 1)
        self.assertEqual(snapshot["project"]["title"], "Example review")

    def test_canonical_sources_join_literature_and_reference_ids_without_touching_screening(self):
        snapshot = collect_project_sources(
            "project-1", self.project, lambda _project_id, key: self.modules[key]
        )

        self.assertEqual(len(snapshot["canonical_sources"]), 1)
        source = snapshot["canonical_sources"][0]
        self.assertEqual(source["canonical_source_id"], "lit-1")
        self.assertIn("ref-1", source["aliases"])
        self.assertEqual(
            snapshot["modules"]["study_screening"]["content"]["records"][0]["source_id"],
            "lit-1",
        )

    def test_source_modules_and_project_are_not_mutated(self):
        original_project = {**self.project, "modules": dict(self.project["modules"])}
        original_modules = {key: dict(value) for key, value in self.modules.items()}

        collect_project_sources(
            "project-1", self.project, lambda _project_id, key: self.modules[key]
        )

        self.assertEqual(self.project, original_project)
        self.assertEqual(self.modules, original_modules)

    def test_missing_module_is_reported_as_empty_not_invented(self):
        snapshot = collect_project_sources(
            "project-1", self.project, lambda _project_id, _key: {}
        )

        self.assertEqual(snapshot["modules"]["study_screening"]["status"], "empty")
        self.assertEqual(snapshot["modules"]["study_screening"]["content"], {})
        self.assertEqual(snapshot["canonical_sources"], [])

    def test_rejects_project_id_mismatch(self):
        with self.assertRaises(ValueError):
            collect_project_sources("another-project", self.project, lambda *_: {})


if __name__ == "__main__":
    unittest.main()