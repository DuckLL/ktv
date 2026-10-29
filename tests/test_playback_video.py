import array
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ktv.core import playback_video as playback


class PlaybackVideoTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise unittest.SkipTest("ffmpeg and ffprobe are required")

    async def asyncSetUp(self):
        for patch in [mock.patch.object(playback, "_jobs", {}), mock.patch.object(playback, "_render_limit", asyncio.Semaphore(1))]:
            patch.start()
            self.addCleanup(patch.stop)

    def make_source(self, directory, codec="libvpx-vp9"):
        source = directory / ("source.webm" if codec == "libvpx-vp9" else "source.mp4")
        # Include a real tone to ensure preparation replaces, rather than copies, audio.
        subprocess.run([
            "ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
            "color=c=blue:s=64x48:r=10:d=2", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=2", "-c:v", codec, "-threads", "1",
            "-c:a", "libopus" if codec == "libvpx-vp9" else "aac", str(source),
        ], check=True)
        return source

    def video_packets(self, path):
        result = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v", "-show_packets",
            "-show_entries", "packet=data_hash", "-show_data_hash", "sha256", "-of", "json", str(path),
        ], capture_output=True, text=True, check=True)
        return [packet["data_hash"] for packet in json.loads(result.stdout)["packets"]]

    async def test_prepared_video_keeps_picture_bytes_and_has_only_silent_audio(self):
        for codec, suffix in [("libvpx-vp9", ".webm"), ("libx264", ".mp4")]:
            with self.subTest(codec=codec), tempfile.TemporaryDirectory() as tmp:
                source = self.make_source(Path(tmp), codec)
                original = hashlib.sha256(source.read_bytes()).digest()
                prepared = await playback.playback_video(source)
                self.assertEqual(prepared.suffix, suffix)
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), original)
                self.assertEqual(self.video_packets(source), self.video_packets(prepared))
                metadata = json.loads(subprocess.run([
                    "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(prepared),
                ], capture_output=True, text=True, check=True).stdout)
                self.assertEqual([stream["codec_type"] for stream in metadata["streams"]], ["video", "audio"])
                self.assertAlmostEqual(float(metadata["format"]["duration"]), 2, delta=0.1)
                decoded = subprocess.run([
                    "ffmpeg", "-nostdin", "-v", "error", "-i", str(prepared), "-map", "0:a:0", "-f", "f32le", "-",
                ], capture_output=True, check=True).stdout
                samples = array.array("f")
                samples.frombytes(decoded)
                self.assertGreater(len(samples), 48000)
                self.assertEqual(max(abs(sample) for sample in samples), 0)

    async def test_requests_share_preparation_and_new_source_invalidates_cached_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = self.make_source(Path(tmp))
            with mock.patch.object(playback, "_render", wraps=playback._render) as render:
                outputs = await asyncio.gather(*(playback.playback_video(source) for _ in range(4)))
                self.assertEqual(len(set(outputs)), 1)
                self.assertEqual(render.call_count, 1)
                self.assertEqual(await playback.playback_video(source), outputs[0])
                self.assertEqual(render.call_count, 1)
                metadata = source.stat()
                os.utime(source, ns=(metadata.st_atime_ns, metadata.st_mtime_ns + 1000000))
                replaced = await playback.playback_video(source)
                self.assertNotEqual(replaced, outputs[0])
                self.assertEqual(render.call_count, 2)
                self.assertTrue(outputs[0].is_file(), "Existing playback should keep reading its original cached file")
