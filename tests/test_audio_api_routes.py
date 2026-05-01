import unittest

from ktv.api.video import router


class AudioApiRouteTests(unittest.TestCase):
    def test_original_audio_endpoint_is_not_registered(self):
        paths = {route.path for route in router.routes}

        self.assertIn("/audio/{video_id}/instrumental", paths)
        self.assertIn("/audio/{video_id}/vocals", paths)
        self.assertNotIn("/audio/{video_id}/original", paths)


if __name__ == "__main__":
    unittest.main()
