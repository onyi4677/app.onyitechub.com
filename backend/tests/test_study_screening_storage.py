import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.services import study_screening_storage as storage


class FakeBatchWriter:
    def __init__(self, table):
        self.table = table

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def put_item(self, Item):
        self.table.items[(Item["project_id"], Item["record_key"])] = Item

    def delete_item(self, Key):
        self.table.items.pop((Key["project_id"], Key["record_key"]), None)


class FakeTable:
    def __init__(self):
        self.items = {}
        self.put_calls = []
        self.query_calls = []

    def get_item(self, Key, **kwargs):
        item = self.items.get((Key["project_id"], Key["record_key"]))
        return {"Item": item} if item else {}

    def batch_writer(self, **kwargs):
        return FakeBatchWriter(self)

    def put_item(self, Item, **kwargs):
        self.put_calls.append({"Item": Item, **kwargs})
        self.items[(Item["project_id"], Item["record_key"])] = Item

    def update_item(self, Key, **kwargs):
        current = self.items[(Key["project_id"], Key["record_key"])]
        values = kwargs["ExpressionAttributeValues"]
        if current.get("active_generation") != values[":previous"]:
            from botocore.exceptions import ClientError
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "Conflict"}},
                "UpdateItem",
            )
        current.update({
            "active_generation": values[":generation"],
            "list_fields": values[":fields"],
            "metadata": values[":metadata"],
            "updated_at": values[":updated"],
        })

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        # Each test uses one active generation, so returning all project data rows
        # is sufficient to exercise the storage reader.
        project_id = "project-1"
        return {
            "Items": [
                item for (pid, _), item in self.items.items()
                if pid == project_id and item.get("record_key", "").startswith("DATA#")
            ]
        }


class StudyScreeningStorageTests(unittest.TestCase):
    def setUp(self):
        self.table = FakeTable()
        self.patch_table = patch.object(storage, "study_screening_table", self.table)
        self.patch_table.start()
        self.addCleanup(self.patch_table.stop)

    def test_save_splits_lists_into_items_and_load_reassembles_them(self):
        content = {
            "review_type": "scoping",
            "protocol_version": "2",
            "records": [
                {"screening_id": "screen-1", "title_snapshot": "Study One"},
                {"screening_id": "screen-2", "title_snapshot": "Study Two"},
            ],
            "evidence_extractions": [{"Evidence domain": "PTSD"}],
            "source_verifications": [],
            "import_batches": [{"filename": "screening.xlsx"}],
            "search_provenance": [{"source": "Excel workbook import"}],
        }

        saved = storage.save("project-1", content)
        loaded = storage.load("project-1")

        self.assertEqual(saved["review_type"], "scoping")
        self.assertEqual(loaded["review_type"], "scoping")
        self.assertEqual(loaded["protocol_version"], "2")
        self.assertEqual(loaded["records"], content["records"])
        self.assertEqual(loaded["evidence_extractions"], content["evidence_extractions"])
        self.assertEqual(loaded["source_verifications"], [])
        self.assertEqual(loaded["import_batches"], content["import_batches"])
        self.assertEqual(loaded["search_provenance"], content["search_provenance"])

        data_items = [
            item for item in self.table.items.values()
            if item.get("record_key", "").startswith("DATA#")
        ]
        self.assertEqual(len(data_items), 5)
        self.assertIn(("project-1", "META"), self.table.items)

    def test_rejects_an_oversized_single_entry_before_writing(self):
        content = {"records": [{"notes": "x" * (301 * 1024)}]}

        with self.assertRaises(HTTPException) as raised:
            storage.save("project-1", content)

        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(self.table.items, {})

    def test_unconfigured_storage_is_detected(self):
        with patch.object(storage, "study_screening_table", None):
            self.assertFalse(storage.is_configured())


if __name__ == "__main__":
    unittest.main()
