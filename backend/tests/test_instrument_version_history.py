import unittest

from fastapi import HTTPException

from app.services.project_modules import _protect_instrument_history


class InstrumentVersionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.version = {
            "version_id": "version-1",
            "version_number": 1,
            "created_at": "2026-11-12T00:00:00+00:00",
            "snapshot": {"instrument_title": "Questionnaire v1", "instrument_items": []},
        }
        self.validation = {
            "validation_id": "validation-1",
            "version_id": "version-1",
            "status": "review_pending",
        }
        self.existing = {
            "pathways": {
                "primary_data": {
                    "instrument_versions": [self.version],
                    "validation_records": [self.validation],
                }
            }
        }

    def test_allows_appending_a_new_instrument_version(self):
        version_two = {
            "version_id": "version-2",
            "version_number": 2,
            "created_at": "2026-11-12T01:00:00+00:00",
            "snapshot": {"instrument_title": "Questionnaire v2", "instrument_items": []},
        }
        incoming = {
            "pathways": {
                "primary_data": {
                    "instrument_versions": [self.version, version_two],
                    "validation_records": [self.validation],
                }
            }
        }

        result = _protect_instrument_history(self.existing, incoming)

        self.assertEqual(len(result["pathways"]["primary_data"]["instrument_versions"]), 2)

    def test_rejects_modifying_an_existing_version_snapshot(self):
        changed = {**self.version, "snapshot": {"instrument_title": "Tampered"}}
        incoming = {
            "pathways": {
                "primary_data": {
                    "instrument_versions": [changed],
                    "validation_records": [self.validation],
                }
            }
        }

        with self.assertRaises(HTTPException) as raised:
            _protect_instrument_history(self.existing, incoming)

        self.assertEqual(raised.exception.status_code, 422)

    def test_rejects_removing_an_existing_version(self):
        incoming = {"pathways": {"primary_data": {"instrument_versions": [], "validation_records": [self.validation]}}}

        with self.assertRaises(HTTPException) as raised:
            _protect_instrument_history(self.existing, incoming)

        self.assertEqual(raised.exception.status_code, 422)

    def test_rejects_removing_or_reassigning_an_existing_validation_record(self):
        reassigned = {**self.validation, "version_id": "version-2"}
        incoming = {
            "pathways": {
                "primary_data": {
                    "instrument_versions": [self.version],
                    "validation_records": [reassigned],
                }
            }
        }

        with self.assertRaises(HTTPException) as raised:
            _protect_instrument_history(self.existing, incoming)

        self.assertEqual(raised.exception.status_code, 422)

    def test_preserves_history_when_older_client_omits_history_fields(self):
        incoming = {"pathways": {"primary_data": {"instrument_title": "Updated title"}}}

        result = _protect_instrument_history(self.existing, incoming)
        pathway = result["pathways"]["primary_data"]

        self.assertEqual(pathway["instrument_versions"], [self.version])
        self.assertEqual(pathway["validation_records"], [self.validation])

