import unittest
from unittest.mock import patch

from app import main


class IntegrityCleanupHandlerTests(unittest.TestCase):
    def test_scheduled_event_runs_cleanup_instead_of_fastapi(self):
        expected = {"checked": 2, "cleaned": 2, "failed": 0}
        event = {
            "source": "aws.events",
            "detail": {"task": "integrity-retention-cleanup"},
        }
        with patch.object(main, "cleanup_expired_submissions", return_value=expected) as cleanup:
            result = main.handler(event, None)

        self.assertEqual(result, expected)
        cleanup.assert_called_once_with()

    def test_non_cleanup_event_is_forwarded_to_fastapi_adapter(self):
        event = {"version": "2.0", "routeKey": "GET /"}
        expected = {"statusCode": 200, "body": "ok"}
        with patch.object(main, "api_handler", return_value=expected) as api_handler:
            result = main.handler(event, None)

        self.assertEqual(result, expected)
        api_handler.assert_called_once_with(event, None)


if __name__ == "__main__":
    unittest.main()
