import unittest
from fastapi import HTTPException

from app.api.instrument_review_routes import _token_key


class InstrumentReviewTokenTests(unittest.TestCase):
    def test_token_key_uses_one_way_sha256_digest(self):
        token = "a" * 64
        key = _token_key(token)
        self.assertTrue(key.startswith("instrument-review-invite#"))
        self.assertNotIn(token, key)
        self.assertEqual(key, _token_key(token))

    def test_different_tokens_produce_different_keys(self):
        self.assertNotEqual(_token_key("a" * 64), _token_key("b" * 64))

    def test_rejects_short_or_missing_tokens(self):
        for token in ("", "short", None):
            with self.subTest(token=token):
                with self.assertRaises(HTTPException) as raised:
                    _token_key(token)
                self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
