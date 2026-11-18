import hashlib
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.research_publication_routes import (
    ResearchPublishRequest,
    ResearchSubmitRequest,
    create_research_publication,
    get_public_research_publication,
    submit_research_publication,
)


def project():
    return {
        "id": "project-1",
        "owner_sub": "research-owner",
        "modules": {
            "instruments": {
                "pathways": {
                    "primary_data": {
                        "instrument_versions": [{
                            "version_id": "version-4",
                            "version_number": 4,
                            "snapshot": {
                                "instrument_title": "Version 4 questionnaire",
                                "purpose": "Study purpose",
                                "target_population": "Adults aged 18–35 in Anambra State",
                                "instrument_instructions": "Answer honestly.",
                                "instrument_sections": [{"section_id": "s1", "title": "Section 1"}],
                                "instrument_items": [{
                                    "item_id": "q1",
                                    "section_id": "s1",
                                    "prompt": "Question one",
                                    "response_type": "short_text",
                                    "required": True,
                                    "options": [],
                                }],
                            },
                        }]
                    }
                }
            }
        },
    }


class ResearchPublicationRouteTests(unittest.TestCase):
    def setUp(self):
        self.user = {"sub": "research-owner"}
        self.info = "This participant information sheet describes the study, procedures, risks, benefits and confidentiality arrangements. " * 2
        self.consent = "I have read the information and voluntarily agree to participate in this study."

    def test_publish_request_normalizes_blank_approval_fields(self):
        payload = ResearchPublishRequest(
            version_id="version-4",
            ethics_committee="",
            approval_reference="   ",
            approval_date="",
            participant_information=self.info,
            consent_text=self.consent,
            eligibility_text="I confirm I am aged 18–35 and live in Anambra State.",
            withdrawal_text="I may withdraw as described in the participant information sheet.",
            consent_version="1.0",
        )
        self.assertIsNone(payload.ethics_committee)
        self.assertIsNone(payload.approval_reference)
        self.assertIsNone(payload.approval_date)

    def publish_payload(self):
        return ResearchPublishRequest(
            version_id="version-4",
            ethics_committee="Example Research Ethics Committee",
            approval_reference="REC/2026/001",
            approval_date="2026-11-18",
            participant_information=self.info,
            consent_text=self.consent,
            eligibility_text="I confirm I am aged 18–35 and live in Anambra State.",
            withdrawal_text="I may withdraw as described in the participant information sheet.",
            consent_version="1.0",
        )

    @patch("app.api.research_publication_routes.projects_table.put_item")
    @patch("app.api.research_publication_routes.projects_table.get_item")
    def test_create_research_publication_uses_immutable_version_and_research_mode(self, get_item, put_item):
        get_item.return_value = {"Item": project()}
        result = create_research_publication("project-1", self.publish_payload(), user=self.user)

        stored = put_item.call_args.kwargs["Item"]
        self.assertEqual(result["mode"], "research")
        self.assertEqual(result["status"], "research_open")
        self.assertFalse(stored["is_test"])
        self.assertEqual(stored["version_id"], "version-4")
        self.assertEqual(stored["snapshot"], project()["modules"]["instruments"]["pathways"]["primary_data"]["instrument_versions"][0]["snapshot"])
        self.assertEqual(stored["consent_hash"], hashlib.sha256("\n".join([self.info.strip(), self.consent.strip(), "I confirm I am aged 18–35 and live in Anambra State.", "I may withdraw as described in the participant information sheet."]).encode()).hexdigest())
        self.assertEqual(stored["approval_reference"], "REC/2026/001")


    @patch("app.api.research_publication_routes.projects_table.put_item")
    @patch("app.api.research_publication_routes.projects_table.get_item")
    def test_create_research_publication_allows_blank_pending_approval_fields(self, get_item, put_item):
        get_item.return_value = {"Item": project()}
        payload = self.publish_payload()
        payload.ethics_committee = None
        payload.approval_reference = None
        payload.approval_date = None
        result = create_research_publication("project-1", payload, user=self.user)
        stored = put_item.call_args.kwargs["Item"]
        self.assertEqual(result["mode"], "research")
        self.assertEqual(stored["ethics_committee"], "")
        self.assertEqual(stored["approval_reference"], "")
        self.assertEqual(stored["approval_date"], "")

    @patch("app.api.research_publication_routes.projects_table.get_item")
    def test_public_endpoint_returns_participant_documents_and_versioned_consent(self, get_item):
        publication = {
            "entity_type": "participant_publication",
            "publication_id": "pub-1",
            "mode": "research",
            "status": "research_open",
            "version_number": 4,
            "snapshot": project()["modules"]["instruments"]["pathways"]["primary_data"]["instrument_versions"][0]["snapshot"],
            "participant_information": self.info,
            "consent_text": self.consent,
            "eligibility_text": "Eligible adults.",
            "withdrawal_text": "Withdrawal details.",
            "consent_version": "1.0",
            "consent_hash": "a" * 64,
        }
        get_item.return_value = {"Item": publication}
        result = get_public_research_publication("x" * 48)
        self.assertEqual(result["version_number"], 4)
        self.assertEqual(result["consent_version"], "1.0")
        self.assertEqual(result["consent_hash"], "a" * 64)
        self.assertEqual(result["participant_information"], self.info)

    @patch("app.api.research_publication_routes.projects_table.put_item")
    @patch("app.api.research_publication_routes.projects_table.get_item")
    def test_submit_stores_response_in_research_namespace_with_consent_evidence(self, get_item, put_item):
        publication = {
            "entity_type": "participant_publication",
            "publication_id": "pub-1",
            "project_id": "project-1",
            "owner_sub": "research-owner",
            "version_id": "version-4",
            "version_number": 4,
            "mode": "research",
            "status": "research_open",
            "consent_version": "1.0",
            "consent_hash": "b" * 64,
            "snapshot": {"instrument_items": [{
                "item_id": "q1", "response_type": "short_text", "required": True,
            }]},
        }
        get_item.return_value = {"Item": publication}
        payload = ResearchSubmitRequest(
            token="t" * 48,
            browser_token="browser-token-" + "b" * 20,
            consent=True,
            consent_version="1.0",
            consent_hash="b" * 64,
            consented_at="2026-11-18T15:49:00Z",
            eligible=True,
            answers={"q1": "A response"},
            elapsed_seconds=30,
        )
        result = submit_research_publication(payload)
        self.assertEqual(result["status"], "submitted")
        self.assertEqual(put_item.call_count, 2)
        dedupe, response = [call.kwargs["Item"] for call in put_item.call_args_list]
        self.assertEqual(dedupe["entity_type"], "participant_research_dedupe")
        self.assertEqual(response["entity_type"], "participant_research_response")
        self.assertEqual(response["mode"], "research")
        self.assertFalse(response["is_test"])
        self.assertTrue(response["consent"])
        self.assertEqual(response["consent_version"], "1.0")
        self.assertEqual(response["consent_hash"], "b" * 64)
        self.assertIn("consented_at", response)

    @patch("app.api.research_publication_routes.projects_table.get_item")
    def test_submission_rejects_changed_consent_document(self, get_item):
        get_item.return_value = {"Item": {
            "entity_type": "participant_publication",
            "publication_id": "pub-1",
            "mode": "research",
            "status": "research_open",
            "consent_version": "2.0",
            "consent_hash": "c" * 64,
        }}
        payload = ResearchSubmitRequest(
            token="t" * 48,
            browser_token="browser-token-" + "b" * 20,
            consent=True,
            consent_version="1.0",
            consent_hash="b" * 64,
            consented_at="2026-11-18T15:49:00Z",
            eligible=True,
            answers={},
            elapsed_seconds=30,
        )
        with self.assertRaises(HTTPException) as raised:
            submit_research_publication(payload)
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
