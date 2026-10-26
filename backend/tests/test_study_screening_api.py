import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes import ModuleUpdateRequest, update_project_module


def project_with_sources():
    return {
        "id": "project-1",
        "modules": {
            "literature_evidence": {
                "sources": [
                    {
                        "source_id": "lit-1",
                        "authors": ["A. Author"],
                        "year": 2020,
                        "title": "Example Study",
                        "doi": "https://doi.org/10.1000/example",
                    }
                ],
                "evidence_items": [
                    {"evidence_id": "ev-1", "source_id": "lit-1"}
                ],
                "claims": [
                    {"claim_id": "cl-1", "source_ids": ["lit-1"]}
                ],
            },
            "references_citations": {
                "references": [
                    {
                        "reference_id": "ref-1",
                        "authors": ["A. Author"],
                        "year": 2020,
                        "title": "Example Study",
                        "doi": "10.1000/EXAMPLE",
                    }
                ]
            },
        },
    }


def record(source_id="lit-1", **overrides):
    value = {
        "screening_id": "screen-1",
        "source_id": source_id,
        "title_snapshot": "Example Study",
        "citation_snapshot": "A. Author (2020). Example Study.",
        "protocol_snapshot": "",
        "title_abstract_decision": "not_screened",
        "title_abstract_reason": "",
        "full_text_decision": "not_assessed",
        "full_text_reason": "",
        "retrieval_attempts": [],
        "notes": "",
        "decision_history": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    value.update(overrides)
    return value


class StudyScreeningApiTests(unittest.TestCase):
    def setUp(self):
        self.project = project_with_sources()
        self.get_item_patcher = patch("app.api.routes.projects_table.get_item")
        self.get_item = self.get_item_patcher.start()
        self.get_item.return_value = {"Item": self.project}
        self.addCleanup(self.get_item_patcher.stop)

        self.save_patcher = patch("app.api.routes.save_module")
        self.save_module = self.save_patcher.start()
        self.save_module.side_effect = lambda project_id, module_key, content: content
        self.addCleanup(self.save_patcher.stop)

    def update(self, records):
        return update_project_module(
            "project-1",
            "methodology",
            ModuleUpdateRequest(content={"study_screening": {"records": records, "protocol_version": "1"}}),
        )

    def test_valid_record_saves_and_resolves_reference_alias_to_literature_id(self):
        response = self.update([record(source_id="ref-1")])

        self.assertEqual(response["status"], "saved")
        saved_records = self.save_module.call_args.args[2]["study_screening"]["records"]
        self.assertEqual(saved_records[0]["source_id"], "lit-1")
        self.save_module.assert_called_once()

    def test_rejects_source_not_in_project_registry(self):
        with self.assertRaises(HTTPException) as raised:
            self.update([record(source_id="unknown-source")])

        self.assertEqual(raised.exception.status_code, 422)
        self.save_module.assert_not_called()

    def test_rejects_duplicate_records_that_resolve_to_same_canonical_source(self):
        with self.assertRaises(HTTPException) as raised:
            self.update([
                record(source_id="lit-1"),
                record(
                    source_id="ref-1",
                    screening_id="screen-2",
                ),
            ])

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("only once", raised.exception.detail)
        self.save_module.assert_not_called()

    def test_exclusion_requires_a_reason(self):
        with self.assertRaises(HTTPException) as raised:
            self.update([record(title_abstract_decision="exclude")])

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("require a reason", raised.exception.detail)
        self.save_module.assert_not_called()

    def test_full_text_decision_requires_title_abstract_to_advance(self):
        with self.assertRaises(HTTPException) as raised:
            self.update([record(full_text_decision="include")])

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("requires a title/abstract decision", raised.exception.detail)
        self.save_module.assert_not_called()

    def test_not_retrieved_requires_documented_retrieval_attempts(self):
        with self.assertRaises(HTTPException) as raised:
            self.update([
                record(
                    title_abstract_decision="include",
                    full_text_decision="not_retrieved",
                )
            ])

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("retrieval attempts", raised.exception.detail)
        self.save_module.assert_not_called()


    def test_screening_save_preserves_existing_methodology_fields(self):
        self.project["modules"]["methodology"] = {
            "review_question": "Existing review question",
            "eligibility_criteria": "Approved eligibility criteria",
        }

        self.update([record()])

        saved = self.save_module.call_args.args[2]
        self.assertEqual(saved["review_question"], "Existing review question")
        self.assertEqual(saved["eligibility_criteria"], "Approved eligibility criteria")
        self.assertEqual(len(saved["study_screening"]["records"]), 1)

    def test_methodology_save_preserves_existing_screening_log(self):
        existing_screening = {
            "records": [record()],
            "protocol_version": "1",
        }
        self.project["modules"]["methodology"] = {
            "review_question": "Old question",
            "study_screening": existing_screening,
        }

        update_project_module(
            "project-1",
            "methodology",
            ModuleUpdateRequest(content={"review_question": "Updated question"}),
        )

        saved = self.save_module.call_args.args[2]
        self.assertEqual(saved["review_question"], "Updated question")
        self.assertEqual(saved["study_screening"], existing_screening)


if __name__ == "__main__":
    unittest.main()
