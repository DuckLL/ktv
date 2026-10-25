"""Prepare stable practice targets from cached F0 without running separation again."""

import asyncio
import json
import math
import subprocess
from pathlib import Path
from statistics import median

import numpy as np

ANALYSIS_VERSION = 3
_locks: dict[Path, asyncio.Lock] = {}


def voiced_runs(values):
    start = None
    for i, value in enumerate([*values, None]):
        if value is not None and start is None:
            start = i
        elif value is None and start is not None:
            yield start, i
            start = None


def stabilize_midi(values: list, hop: float) -> list:
    """Repair short, returning octave errors; retain sustained jumps and rests."""
    clean = [float(v) if isinstance(v, (int, float)) and math.isfinite(v) and 24 <= v <= 108 else None for v in values]
    context = max(4, round(0.24 / hop))
    for start, end in list(voiced_runs(clean)):
        if (end - start) * hop < 0.064:
            clean[start:end] = [None] * (end - start)
            continue
        bounds = [start, *(i for i in range(start + 1, end) if abs(clean[i] - clean[i - 1]) > 3), end]
        for left, right in zip(bounds, bounds[1:]):
            if (right - left) * hop > 0.18:
                continue
            before = [v for v in clean[max(start, left - context):left] if v is not None]
            after = [v for v in clean[right:min(end, right + context)] if v is not None]
            level = median(clean[left:right])
            if left == start or right == end:
                neighbor = before if right == end else after
                if len(neighbor) >= 4 and (right - left) * hop <= 0.064 and abs(level - median(neighbor)) > 7:
                    clean[left:right] = [None] * (right - left)
                continue
            if min(len(before), len(after)) < 3:
                continue
            a, b = median(before), median(after)
            if abs(a - b) > 1.25:
                continue
            baseline = (a + b) / 2
            octave = round((level - baseline) / 12)
            if abs(octave) in (1, 2) and abs(level - baseline - 12 * octave) < 0.9:
                clean[left:right] = [v - 12 * octave for v in clean[left:right]]
            elif abs(level - baseline) > 5 and (right - left) * hop <= 0.064:
                clean[left:right] = [None] * (right - left)
    # Each voiced run is filtered separately: silence never becomes a target.
    result = clean.copy()
    for start, end in voiced_runs(clean):
        for i in range(start, end):
            result[i] = round(median(clean[max(start, i - 2):min(end, i + 3)]), 2)
    return result


def note_segments(values: list, hop: float) -> list[dict]:
    """Require a persistent pitch change before starting another guide bar."""
    notes = []
    hold = max(3, math.ceil(0.08 / hop))
    for start, end in voiced_runs(values):
        left = start
        center = median(values[start:min(end, start + hold)])
        candidate = None
        for i in range(start, end):
            if abs(values[i] - center) <= 0.85:
                candidate = None
            elif candidate is None:
                candidate = i
            elif i - candidate + 1 >= hold:
                notes.append({"start": round(left * hop, 3), "end": round(candidate * hop, 3), "midi": round(median(values[left:candidate]), 2)})
                left = candidate
                center = median(values[candidate:i + 1])
                candidate = None
        if end - left >= 3:
            notes.append({"start": round(left * hop, 3), "end": round(end * hop, 3), "midi": round(median(values[left:end]), 2)})
    return notes


def estimate_beats(audio: np.ndarray, rate: int = 8000) -> dict:
    """Track strong periodic spectral onsets; return no grid when uncertain."""
    empty = {"beats": [], "bpm": None}
    frame, hop = 512, 128
    if len(audio) < rate * 4 or np.max(np.abs(audio)) < 1e-5:
        return empty
    windows = np.lib.stride_tricks.sliding_window_view(audio, frame)[::hop]
    # Chunk the FFT so a ten-minute song does not allocate a full spectrogram.
    flux = []
    previous = np.zeros(frame // 2 + 1)
    for begin in range(0, len(windows), 1024):
        spectra = np.log1p(np.abs(np.fft.rfft(windows[begin:begin + 1024] * np.hanning(frame))))
        diff = np.diff(np.vstack((previous, spectra)), axis=0)
        flux.extend(np.maximum(diff, 0).mean(axis=1))
        previous = spectra[-1]
    envelope = np.asarray(flux)
    if np.percentile(envelope, 95) < 1e-4:
        return empty
    envelope = np.maximum(envelope - np.percentile(envelope, 45), 0)
    envelope = np.convolve(envelope, [0.25, 0.5, 0.25], mode="same")
    nfft = 1 << (2 * len(envelope) - 1).bit_length()
    spectrum = np.fft.rfft(envelope - envelope.mean(), nfft)
    correlation = np.fft.irfft(abs(spectrum) ** 2, nfft)[:len(envelope)]
    if correlation[0] <= 0:
        return empty
    step = hop / rate
    lags = np.arange(math.ceil(60 / 190 / step), math.floor(60 / 50 / step) + 1)
    lag = int(lags[np.argmax(correlation[lags])])
    if correlation[lag] / correlation[0] < 0.18:
        return empty
    denominator = correlation[lag - 1] - 2 * correlation[lag] + correlation[lag + 1]
    fraction = 0.5 * (correlation[lag - 1] - correlation[lag + 1]) / denominator if denominator else 0
    period = lag + float(np.clip(fraction, -0.5, 0.5))
    phase = max(range(math.ceil(period)), key=lambda i: float(envelope[np.arange(i, len(envelope), period).astype(int)].sum()))
    beats = []
    cursor = phase
    radius = max(1, round(min(0.06, lag * step * 0.12) / step))
    while cursor < len(envelope):
        lo, hi = max(0, round(cursor) - radius), min(len(envelope), round(cursor) + radius + 1)
        peak = lo + int(np.argmax(envelope[lo:hi]))
        beats.append(round((peak * hop + frame / 2) / rate, 3))
        # Follow local onset timing instead of accumulating a rounded-frame tempo error.
        cursor = (peak if envelope[peak] > envelope.mean() else cursor) + period
    return {"beats": beats, "bpm": round(60 / (period * step), 1)}


def _prepare(job_dir: Path) -> Path:
    source = job_dir / "pitch.json"
    accompaniment = job_dir / "no_vocals.webm"
    dest = job_dir / "practice_pitch.json"
    signature = [ANALYSIS_VERSION, source.stat().st_mtime_ns, source.stat().st_size,
                 accompaniment.stat().st_mtime_ns if accompaniment.exists() else None]
    try:
        if json.loads(dest.read_text()).get("source_signature") == signature:
            return dest
    except (OSError, ValueError, AttributeError):
        pass
    data = json.loads(source.read_text())
    hop = data.get("hop_seconds", 0)
    if data.get("version") != 1 or not isinstance(hop, (int, float)) or not 0.001 <= hop <= 0.1 or not isinstance(data.get("midi"), list):
        raise ValueError("Invalid pitch data")
    data["midi"] = stabilize_midi(data["midi"], hop)
    data["notes"] = note_segments(data["midi"], hop)
    data.update({"beats": [], "bpm": None})
    if accompaniment.is_file():
        try:
            decoded = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", str(accompaniment), "-t", "600", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"],
                capture_output=True, check=True, timeout=35,
            )
            data.update(estimate_beats(np.frombuffer(decoded.stdout, dtype="<f4")))
        except (OSError, subprocess.SubprocessError):
            pass  # Stable pitch remains available when beat analysis is unavailable.
    data["source_signature"] = signature
    temporary = dest.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, allow_nan=False))
    temporary.replace(dest)
    return dest


async def prepare_practice_reference(job_dir: Path) -> Path:
    lock = _locks.setdefault(job_dir, asyncio.Lock())
    async with lock:
        return await asyncio.to_thread(_prepare, job_dir)
