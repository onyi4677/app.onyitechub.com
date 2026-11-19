import unittest
from botocore.exceptions import ClientError

from app.services.manuscript_storage import cleanup_expired_workspaces


class FakeBatch:
    def __init__(self, table):
        self.table = table

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def delete_item(self, Key):
        self.table.deleted_children.append(Key)


class FakeTable:
    def __init__(self):
        self.workspace = {
            "project_id": "p1",
            "record_key": "WORKSPACE",
            "manuscript_id": "m1",
            "cleanup_status": "pending",
            "cleanup_at": 100,
            "owner_sub": "owner-1",
        }
        self.deleted_children = []
        self.workspace_deleted = False

    def query(self, **kwargs):
        if kwargs.get("IndexName") == "cleanup-index":
            return {"Items": [dict(self.workspace)]}
        return {
            "Items": [
                dict(self.workspace),
                {
                    "project_id": "p1",
                    "record_key": "VERSION#v1",
                    "manuscript_id": "m1",
                },
                {
                    "project_id": "p1",
                    "record_key": "SECTION#v1#abstract",
                    "manuscript_id": "m1",
                },
                {
                    "project_id": "p1",
                    "record_key": "UNRELATED",
                    "manuscript_id": "another-manuscript",
                },
            ]
        }

    def update_item(self, **kwargs):
        if "SET cleanup_lease_token" in kwargs.get("UpdateExpression", ""):
            self.workspace["cleanup_lease_token"] = kwargs["ExpressionAttributeValues"][":token"]
            return {}
        if self.workspace_deleted:
            raise ClientError(
                {"Error": {"Code": "ResourceNotFoundException", "Message": "deleted"}},
                "UpdateItem",
            )
        self.workspace.pop("cleanup_lease_token", None)
        return {}

    def get_item(self, **kwargs):
        return {"Item": dict(self.workspace)}

    def batch_writer(self):
        return FakeBatch(self)

    def delete_item(self, **kwargs):
        self.workspace_deleted = True
        self.workspace = {}


class ManuscriptCleanupWorkerTests(unittest.TestCase):
    def test_cleanup_deletes_only_the_target_manuscript_and_its_objects(self):
        table = FakeTable()
        deleted_objects = []

        result = cleanup_expired_workspaces(
            now_epoch=200,
            table=table,
            object_deleter=lambda project_id, manuscript_id: deleted_objects.append(
                (project_id, manuscript_id)
            ),
        )

        self.assertEqual(result, {"checked": 1, "cleaned": 1, "failed": 0})
        self.assertEqual(deleted_objects, [("p1", "m1")])
        self.assertEqual(
            table.deleted_children,
            [
                {"project_id": "p1", "record_key": "VERSION#v1"},
                {"project_id": "p1", "record_key": "SECTION#v1#abstract"},
            ],
        )
        self.assertTrue(table.workspace_deleted)

    def test_cleanup_rejects_invalid_page_size(self):
        with self.assertRaises(ValueError):
            cleanup_expired_workspaces(page_size=0, table=FakeTable())


if __name__ == "__main__":
    unittest.main()
