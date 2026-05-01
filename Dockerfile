FROM python:3.12-slim

# System dependencies: ffmpeg for muxing, git for demucs model download
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy project metadata first for layer caching
COPY pyproject.toml .python-version ./

# Install Python dependencies (no dev deps)
RUN uv sync --no-dev

# Copy application source
COPY src/ src/

# Pre-download demucs htdemucs model weights (~80 MB) at build time
# so first-run doesn't need internet access
RUN uv run python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs')" || true

RUN mkdir -p cache

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "ktv.main:app", "--host", "0.0.0.0", "--port", "8000"]
