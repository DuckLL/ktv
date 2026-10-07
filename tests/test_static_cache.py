import unittest

from fastapi.testclient import TestClient

from ktv.main import app


class StaticCacheTests(unittest.TestCase):
    def test_pages_and_modules_are_revalidated_after_a_deploy(self):
        client = TestClient(app)  # without `with`, the lifespan (database, eviction) does not run
        for path in ("/", "/player", "/static/js/player.js", "/static/css/style.css"):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "no-cache")
                self.assertIn("etag", response.headers)


if __name__ == "__main__":
    unittest.main()
