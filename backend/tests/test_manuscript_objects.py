import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.services import manuscript_objects


class FakeS3:
    def __init__(self):
        self.pages = [
            {
                "Versions": [
                    {"Key": "projects/p1/manuscripts/m1/exports/a.docx", "VersionId": "v1"},
                ],
                "DeleteMarkers": [
                    {"Key": "projects/p1/manuscripts/m1/exports/a.docx", "VersionId": "d1"},
                ],
                "IsTruncated": True,
                "NextKeyMarker": "projects/p1/manuscripts/m1/exports/a.docx",
                "NextVersionIdMarker": "v1",
            },
            {
                "Versions": [
                    {"Key": "projects/p1/manuscripts/m1/snapshots/s1.json", "VersionId": "v2"},
                ],
                "DeleteMarkers": [],
                "IsTruncated": False,
            },
        ]
        self.deleted_batches = []
        self.list_calls = []

    def list_object_versions(self, **kwargs):
        self.list_calls.append(kwargs)
        return self.pages.pop(0)

    def delete_objects(self, **kwargs):
        self.deleted_batches.append(kwargs["Delete"]["Objects"])
        return {"Deleted": kwargs["Delete"]["Objects"], "Errors": []}


class ManuscriptObjectStorageTests(unittest.TestCase):
    def test_builds_scoped_keys_with_extensions(self):
        key = manuscript_objects.build_object_key(
            "project-1", "manuscript-1", "snapshots", "snapshot.json"
        )
        self.assertEqual(
            key,
            "projects/project-1/manuscripts/manuscript-1/snapshots/snapshot.json",
        )

    def test_builds_durable_project_scoped_source_snapshot_keys(self):
        key = manuscript_objects.build_source_snapshot_key("project-1", "snapshot-1")
        self.assertEqual(key, "projects/project-1/source-snapshots/snapshot-1.json")

    def test_durable_snapshot_key_rejects_path_traversal(self):
        with self.assertRaises(ValueError):
            manuscript_objects.build_source_snapshot_key("project-1", "../snapshot")

    def test_rejects_path_traversal_and_unknown_categories(self):
        with self.assertRaises(ValueError):
            manuscript_objects.manuscript_prefix("../project", "manuscript-1")
        with self.assertRaises(ValueError):
            manuscript_objects.build_object_key("p1", "m1", "other", "x.json")

    def test_deletes_all_versions_and_delete_markers_across_pages(self):
        fake = FakeS3()
        with patch.object(manuscript_objects, "BUCKET_NAME", "onyitech-manuscripts-staging-530751149539"):
            deleted = manuscript_objects.delete_all_manuscript_object_versions(
                "p1", "m1", client=fake
            )

        self.assertEqual(deleted, 3)
        self.assertEqual(len(fake.list_calls), 2)
        self.assertEqual(len(fake.deleted_batches), 2)
        self.assertEqual(
            fake.deleted_batches[0][1]["VersionId"],
            "d1",
        )

    def test_storage_fails_closed_when_bucket_is_not_configured(self):
        with patch.object(manuscript_objects, "BUCKET_NAME", ""):
            with self.assertRaises(HTTPException) as error:
                manuscript_objects.delete_all_manuscript_object_versions("p1", "m1")
        self.assertEqual(error.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
