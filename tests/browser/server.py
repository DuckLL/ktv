"""Browser fixture server. All media, cache cleanup and database writes stay in /tmp."""

import asyncio
import json
import math
import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

# Configure before importing any module that captures these defaults.
os.environ["KTV_CACHE_TTL_DAYS"] = "0"

import numpy as np
import ktv.config as config


def create_media(root: Path) -> Path:
    directory = root / "cache" / "pitchdemo01"
    directory.mkdir(parents=True)
    rate = 44100
    time = np.arange(17 * rate) / rate
    midi = np.select([time < 4, time < 8, time < 12], [69, 71, 72], default=69)
    phase = np.cumsum(2 * np.pi * 440 * 2 ** ((midi - 69) / 12) / rate)
    samples = (0.18 * np.sin(phase) * ((time >= 0.5) & (time < 16.5)) * 32767).astype("<i2")
    with wave.open(str(directory / "original.wav"), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(samples.tobytes())
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(directory / "original.wav"),
        "-c:a", "libopus", str(directory / "no_vocals.webm"),
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
        "color=c=0x171724:s=640x360:r=10:d=17", "-an", "-c:v", "libvpx-vp9",
        "-b:v", "80k", str(directory / "video_only.webm"),
    ], check=True)
    contour = [
        (69 if t < 4 else 71 if t < 8 else 72 if t < 12 else 69) if 0.5 <= t < 16.5 else None
        for t in np.arange(0, 17, 0.016)
    ]
    (directory / "pitch.json").write_text(json.dumps({"version": 1, "hop_seconds": 0.016, "midi": contour}))
    (directory / "meta.json").write_text(json.dumps({
        "video_id": "pitchdemo01", "title": "音準測試旋律", "artist": "KTV Demo", "duration": 17,
    }))
    microphone = root / "microphone.wav"
    samples = (0.2 * np.sin(2 * math.pi * 440 * np.arange(rate) / rate) * 32767).astype("<i2")
    with wave.open(str(microphone), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(samples.tobytes())
    return microphone


with tempfile.TemporaryDirectory(prefix="ktv-browser-") as tmp:
    root = Path(tmp)
    microphone = create_media(root)
    real_media = os.environ.get("KTV_TEST_REAL_MEDIA")
    real_song = None
    if real_media:
        source = Path(real_media).resolve()
        real_song = json.loads((source / "meta.json").read_text())
        shutil.copytree(source, root / "cache" / source.name)
    config.CACHE_DIR = root / "cache"
    config.DATA_DIR = root
    import ktv.core.db as db
    db.DB_PATH = root / "ktv.db"

    async def setup():
        await db.init_db()
        for file in config.CACHE_DIR.glob('*/meta.json'):
            await db.upsert_video(json.loads(file.read_text()), 1)

    asyncio.run(setup())
    from ktv.main import app
    import uvicorn

    port = int(os.environ.get("KTV_TEST_PORT", "8765"))
    print(json.dumps({"url": f"http://127.0.0.1:{port}", "microphone": str(microphone), "real_song": real_song}), flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
