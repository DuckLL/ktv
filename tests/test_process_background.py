import asyncio
import json
import unittest
from unittest import mock

from fastapi.responses import JSONResponse

import ktv.api.process as process_module


class ProcessBackgroundTests(unittest.IsolatedAsyncioTestCase):
    async def test_process_returns_queued_response_after_registering_pending_video(self):
        calls = []
        created_tasks = []

        async def fake_upsert_pending_video(video_id):
            calls.append(video_id)

        def fake_create_task(coro):
            created_tasks.append(coro)
            return object()

        original_extract = process_module._extract_video_id
        original_ready = process_module.separated_audio_ready
        original_create_task = process_module.asyncio.create_task
        original_pending = getattr(process_module, "upsert_pending_video", None)
        try:
            process_module._extract_video_id = lambda _url: "abc12345678"
            process_module.separated_audio_ready = lambda _video_id: False
            process_module.asyncio.create_task = fake_create_task
            process_module.upsert_pending_video = fake_upsert_pending_video

            resp = await process_module.process(
                process_module.ProcessRequest(url="https://youtu.be/abc12345678")
            )
        finally:
            process_module._extract_video_id = original_extract
            process_module.separated_audio_ready = original_ready
            process_module.asyncio.create_task = original_create_task
            if original_pending is None:
                delattr(process_module, "upsert_pending_video")
            else:
                process_module.upsert_pending_video = original_pending
            for task in created_tasks:
                close = getattr(task, "close", None)
                if close:
                    close()

        self.assertIsInstance(resp, JSONResponse)
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(json.loads(resp.body), {"status": "queued", "video_id": "abc12345678"})
        self.assertEqual(calls, ["abc12345678"])
        self.assertEqual(len(created_tasks), 1)

    async def test_status_reports_pending_library_row_when_background_job_is_not_in_memory(self):
        async def fake_get_all_videos():
            return [{"video_id": "abc123", "title": "abc123", "artist": "處理中", "processed_at": 0}]

        original_ready = process_module.separated_audio_ready
        original_rows = process_module.get_all_videos
        original_jobs = process_module._jobs
        try:
            process_module.separated_audio_ready = lambda _video_id: False
            process_module.get_all_videos = fake_get_all_videos
            process_module._jobs = {}

            resp = await process_module.status("abc123")
        finally:
            process_module.separated_audio_ready = original_ready
            process_module.get_all_videos = original_rows
            process_module._jobs = original_jobs

        self.assertEqual(resp, {
            "status": "queued",
            "video_id": "abc123",
            "title": "abc123",
            "artist": "處理中",
            "processed_at": 0,
        })

    async def test_status_reports_a_failed_library_row_as_an_error(self):
        async def fake_get_all_videos():
            return [{"video_id": "abc123", "processed_at": 0, "error": "HTTP Error 403"}]

        with mock.patch.object(process_module, "separated_audio_ready", lambda _video_id: False), \
             mock.patch.object(process_module, "get_all_videos", fake_get_all_videos), \
             mock.patch.object(process_module, "_jobs", {}):
            resp = await process_module.status("abc123")

        self.assertEqual(resp["status"], "error")
        self.assertEqual(resp["msg"], "HTTP Error 403")


class BackgroundJobTests(unittest.IsolatedAsyncioTestCase):
    def patch_pipeline(self, separate):
        async def download(url, progress):
            video_id = url.rsplit("/", 1)[-1]
            return video_id, {"video_id": video_id}

        self.failed = []

        async def mark_failed(video_id, error):
            self.failed.append((video_id, error))

        patches = [
            mock.patch.object(process_module, "download_video", download),
            mock.patch.object(process_module, "separate_vocals", separate),
            mock.patch.object(process_module, "upsert_pending_video", mock.AsyncMock()),
            mock.patch.object(process_module, "upsert_video", mock.AsyncMock()),
            mock.patch.object(process_module, "mark_video_failed", mark_failed),
            mock.patch.object(process_module, "_jobs", {}),
            mock.patch.object(process_module, "_separation_slot", asyncio.Semaphore(1)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    async def test_only_one_song_separates_at_a_time(self):
        running, peak = 0, 0
        release = asyncio.Event()

        async def separate(video_id, progress):
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await release.wait()
            running -= 1
            path = mock.MagicMock()
            path.stat.return_value.st_mtime = 100
            return path

        self.patch_pipeline(separate)
        for video_id in ("song1", "song2"):
            process_module._jobs[video_id] = {"status": "queued"}
        jobs = [asyncio.create_task(process_module._run_background_process(f"https://youtu.be/{video_id}", video_id))
                for video_id in ("song1", "song2")]
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        self.assertEqual(peak, 1)
        self.assertIn("排隊", process_module._jobs["song2"]["msg"])
        release.set()
        await asyncio.gather(*jobs)
        self.assertEqual(peak, 1)
        self.assertEqual([process_module._jobs[v]["status"] for v in ("song1", "song2")], ["done", "done"])

    async def test_failure_is_recorded_in_the_library(self):
        async def separate(video_id, progress):
            raise RuntimeError("demucs exited with code -9")

        self.patch_pipeline(separate)
        process_module._jobs["song1"] = {"status": "queued"}
        await process_module._run_background_process("https://youtu.be/song1", "song1")

        self.assertEqual(process_module._jobs["song1"]["status"], "error")
        self.assertEqual(self.failed, [("song1", "demucs exited with code -9")])


if __name__ == "__main__":
    unittest.main()
