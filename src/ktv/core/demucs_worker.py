"""Run the pinned Demucs model and save float PCM without rescaling stems."""

import sys
from pathlib import Path

import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def separate(input_path: Path, output_path: Path) -> None:
    model = get_model("htdemucs")
    model.cpu().eval()
    torch.set_num_threads(min(4, torch.get_num_threads()))
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
            shifts=1, split=True, overlap=0.25, progress=True,
        )[0]
        sources = sources * scale + mean
        accompaniment = sources[[i for i, stem in enumerate(model.sources) if stem != "vocals"]].sum(0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, accompaniment.T.numpy(), model.samplerate, subtype="FLOAT")


if __name__ == "__main__":
    separate(Path(sys.argv[1]), Path(sys.argv[2]))
