import asyncio
import unittest
from collections import deque

from ktv.core.separator import relay_progress


class SeparationProgressTests(unittest.IsolatedAsyncioTestCase):
    async def relay(self, *chunks):
        stream = asyncio.StreamReader()
        for chunk in chunks:
            stream.feed_data(chunk)
        stream.feed_eof()
        reports, tail = [], deque(maxlen=20)

        async def progress(pct, msg):
            reports.append(pct)

        await relay_progress(stream, progress, tail)
        return reports, tail

    async def test_tqdm_redraws_with_carriage_returns_are_reported_as_they_arrive(self):
        bar = b"  0%|          | 0.0/240.0\r 50%|#####     | 120.0/240.0\r100%|##########| 240.0/240.0\n"
        reports, _ = await self.relay(bar[:30], bar[30:])

        self.assertEqual(reports, [30, 57, 85])

    async def test_repeated_percentages_are_reported_once(self):
        reports, _ = await self.relay(b" 10%|# | 24/240\r 10%|# | 25/240\r 11%|# | 26/240\r")

        self.assertEqual(reports, [35, 36])

    async def test_error_tail_keeps_text_split_across_chunks(self):
        message = "RuntimeError: 記憶體不足\n".encode()
        _, tail = await self.relay(b"100%|##| 240/240\r", message[:16], message[16:])

        self.assertEqual(list(tail)[-1], "RuntimeError: 記憶體不足")


if __name__ == "__main__":
    unittest.main()
