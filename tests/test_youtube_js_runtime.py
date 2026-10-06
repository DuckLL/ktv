import tomllib
import unittest
from pathlib import Path


class YouTubeJsRuntimeTests(unittest.TestCase):
    """YouTube downloads need a JS runtime plus yt-dlp-ejs; without them they fail with 403."""

    def test_image_ships_deno(self):
        dockerfile = Path("Dockerfile").read_text()

        self.assertRegex(dockerfile, r"COPY --from=denoland/deno:bin-[\d.]+ /deno /usr/local/bin/deno")

    def test_yt_dlp_upgraded_last_at_build(self):
        dockerfile = Path("Dockerfile").read_text()
        upgrade = dockerfile.index('--upgrade "yt-dlp[default]"')

        self.assertIn("ARG YTDLP_REFRESH", dockerfile)
        # 必須在模型下載之後，週更才不會連模型一起重抓
        self.assertGreater(upgrade, dockerfile.index("demucs.pretrained.get_model"))
        self.assertLess(dockerfile.index("USER root", dockerfile.index("get_model")), upgrade)
        self.assertGreater(dockerfile.rindex("USER app"), upgrade)

    def test_yt_dlp_installed_with_ejs(self):
        deps = tomllib.loads(Path("pyproject.toml").read_text())["project"]["dependencies"]
        lock = tomllib.loads(Path("uv.lock").read_text())

        self.assertTrue(any(d.startswith("yt-dlp[default]") for d in deps), deps)
        self.assertIn("yt-dlp-ejs", {p["name"] for p in lock["package"]})


if __name__ == "__main__":
    unittest.main()
