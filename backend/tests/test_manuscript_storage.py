import unittest

from app.services.manuscript_storage import (
    DEVELOPMENT_RETENTION_DAYS,
    POST_EXPORT_RETENTION_DAYS,
    build_workspace_item,
    development_expiry,
    post_export_expiry,
)


class ManuscriptRetentionPolicyTests(unittest.TestCase):
    def test_development_workspace_expires_after_30_days_without_export(self):
        now = 1_800_000_000
        item = build_workspace_item(
            "project-1", "owner-1", "Example manuscript", "scoping_review", now
        )
        expected = now + 30 * 24 * 60 * 60

        self.assertEqual(DEVELOPMENT_RETENTION_DAYS, 30)
        self.assertEqual(item["retention_phase"], "development")
        self.assertEqual(item["development_expires_at"], expected)
        self.assertEqual(item["expires_at"], expected)
        self.assertEqual(item["cleanup_at"], expected)
        self.assertEqual(item["ttl"], expected)
        self.assertEqual(item["successful_export_count"], 0)

    def test_successful_export_starts_14_day_post_export_period(self):
        exported_at = 1_800_000_000
        expected = exported_at + 14 * 24 * 60 * 60

        self.assertEqual(POST_EXPORT_RETENTION_DAYS, 14)
        self.assertEqual(post_export_expiry(exported_at), expected)

    def test_later_successful_export_resets_deadline_from_latest_export(self):
        first_export = 1_800_000_000
        second_export = first_export + 5 * 24 * 60 * 60

        first_deadline = post_export_expiry(first_export)
        second_deadline = post_export_expiry(second_export)

        self.assertEqual(second_deadline - second_export, 14 * 24 * 60 * 60)
        self.assertGreater(second_deadline, first_deadline)

    def test_workspace_rejects_missing_identifiers_and_metadata(self):
        with self.assertRaises(ValueError):
            build_workspace_item("", "owner-1", "Title", "scoping_review", 100)
        with self.assertRaises(ValueError):
            build_workspace_item("project-1", "owner-1", "", "scoping_review", 100)


if __name__ == "__main__":
    unittest.main()
