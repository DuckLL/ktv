# uv is pre-installed in this image
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# System dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 999 app && \
    useradd --system --uid 999 --gid 999 --create-home app

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_NO_DEV=1
ENV PATH="/app/.venv/bin:$PATH"

# Install dependencies first (no project source) for layer caching
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project

# Copy source and install project
COPY pyproject.toml uv.lock /app/
COPY src /app/src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

# Create writable runtime paths without rewriting the dependency layer.
RUN mkdir -p /app/cache && \
    touch /app/ktv.db && \
    chown app:app /app /app/cache /app/ktv.db

ENTRYPOINT []

# Pre-download demucs htdemucs model as app user so it lands in /home/app/.cache
USER app
RUN python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs')" || true

EXPOSE 8000
CMD ["uvicorn", "ktv.main:app", "--host", "0.0.0.0", "--port", "8000"]
