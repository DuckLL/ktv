"""Run the pinned Demucs model and save float PCM without rescaling stems."""

import os
import sys
import json
import math
from pathlib import Path

import soundfile as sf
import torch
import torchaudio.functional as AF
from demucs.apply import apply_model
from demucs.pretrained import get_model

# The inference worker needs no telemetry and should not create an ONNX session
# file in the project directory when it starts.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")
from swift_f0 import SwiftF0


def reference_pitch(vocals: torch.Tensor, sample_rate: int) -> dict:
    """Build a compact, song-timed pitch contour from the isolated lead stem."""
    mono = vocals.mean(dim=0)
    mono_16k = AF.resample(mono, sample_rate, 16000).numpy()
    peak = float(abs(mono_16k).max())
    if 0 < peak < 0.1:
        mono_16k *= 0.1 / peak
    result = SwiftF0(threads=2, spin=False).detect(mono_16k, 16000)
    midi = [
        round(69 + 12 * math.log2(float(hz) / 440), 2)
        if confidence >= 0.65 and loudness >= -45 and hz > 0 else None
        for hz, confidence, loudness in zip(
            result.pitch_hz, result.confidence, result.loudness_db
        )
    ]
    return {"version": 1, "hop_seconds": 0.016, "midi": midi}


def separate(input_path: Path, output_path: Path, pitch_path: Path) -> None:
    model = get_model("htdemucs")
    model.cpu().eval()
    # Only one song separates at a time, so use every core, at a lower priority
    # than the web server so playback stays responsive.
    if hasattr(os, "nice"):
        os.nice(10)
    threads = int(os.environ.get("KTV_TORCH_THREADS", "0"))
    if threads > 0:
        torch.set_num_threads(threads)
    samples, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    if sample_rate != model.samplerate or samples.shape[1] != model.audio_channels:
        raise ValueError("Demucs input must match the model sample rate and channels")
    audio = torch.from_numpy(samples.T.copy())
    reference = audio.mean(0)
    mean = reference.mean()
    scale = reference.std().clamp(min=1e-8)
    with torch.inference_mode():
        sources = apply_model(
            model, ((audio - mean) / scale)[None], device="cpu",
            # 0.1 overlap computes ~17% fewer chunks than the 0.25 default.
            shifts=1, split=True, overlap=0.1, progress=True,
        )[0]
        sources = sources * scale + mean
        accompaniment = sources[[i for i, stem in enumerate(model.sources) if stem != "vocals"]].sum(0)
        vocals = sources[model.sources.index("vocals")]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, accompaniment.T.numpy(), model.samplerate, subtype="FLOAT")
    pitch_path.write_text(json.dumps(reference_pitch(vocals, model.samplerate)), encoding="utf-8")


if __name__ == "__main__":
    separate(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
