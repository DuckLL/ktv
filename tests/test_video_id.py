import unittest

from ktv.core.downloader import _extract_video_id


class VideoIdTests(unittest.TestCase):
    def test_supported_youtube_url_shapes(self):
        for url in [
            "https://www.youtube.com/watch?v=abc12345678",
            "https://www.youtube.com/watch?v=abc12345678&list=RDabc12345678&start_radio=1",
            "https://www.youtube.com/watch?feature=share&v=abc12345678",
            "https://music.youtube.com/watch?v=abc12345678",
            "https://youtu.be/abc12345678?si=xyz",
            "https://www.youtube.com/embed/abc12345678",
            "https://www.youtube.com/shorts/abc12345678",
            "https://www.youtube.com/live/abc12345678?feature=share",
        ]:
            with self.subTest(url=url):
                self.assertEqual(_extract_video_id(url), "abc12345678")

    def test_a_parameter_merely_ending_in_v_is_not_a_video_id(self):
        with self.assertRaises(ValueError):
            _extract_video_id("https://www.youtube.com/results?dev=abc12345678")


if __name__ == "__main__":
    unittest.main()
