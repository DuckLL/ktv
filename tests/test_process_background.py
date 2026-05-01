import json
import unittest

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


if __name__ == "__main__":
    unittest.main()
