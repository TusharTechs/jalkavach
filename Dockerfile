# JalKavach command centre: one container (FastAPI API + the built web app in web/dist).
#   docker build -t jalkavach .
#   docker run -p 8036:8036 jalkavach      ->  http://localhost:8036
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 \
    JALKAVACH_ASR_MODEL=small JALKAVACH_HOSTED=1 HF_HOME=/app/.hf PORT=8036
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --extra voice
# bake the speech model into the image so the first voice note does not download it
RUN uv run --no-sync python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

COPY app ./app
COPY configs ./configs
COPY data ./data
COPY results ./results
COPY brand ./brand
COPY web/dist ./web/dist

EXPOSE 8036
CMD ["sh", "-c", "uv run --no-sync uvicorn app.server:app --host 0.0.0.0 --port ${PORT}"]
