FROM ubuntu:22.04 AS builder

# Pinned to the ggml-org/whisper.cpp v1.9.1 release tag (commit
# f049fff95a089aa9969deb009cdd4892b3e74916), not the mutable `master`
# branch, so builds are reproducible and not exposed to a
# compromised/changed upstream branch. Ops: verify/update this
# periodically (e.g. https://github.com/ggml-org/whisper.cpp/releases).
ARG WHISPER_CPP_REF=v1.9.1
ARG WHISPER_MODEL=tiny

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    cmake \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 --branch ${WHISPER_CPP_REF} https://github.com/ggml-org/whisper.cpp.git

WORKDIR /opt/whisper.cpp
RUN cmake -B build -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
RUN cmake --build build -j

# Collect shared libs required by whisper-cli (Render runtime currently misses libwhisper/libggml)
RUN mkdir -p /deps && \
    find /opt/whisper.cpp/build -type f \( -name 'libwhisper.so*' -o -name 'libggml*.so*' \) -exec cp -v '{}' /deps/ \; || true

RUN ./models/download-ggml-model.sh ${WHISPER_MODEL}


FROM python:3.11-slim-bookworm

ARG WHISPER_MODEL=tiny

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Dedicated non-root user for running the app (matches the api/worker/
# ai-orchestrator services, which run as the node-alpine `node` user).
RUN useradd -m -u 1000 appuser

WORKDIR /app

COPY --from=builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /deps/ /usr/local/lib/
COPY --from=builder --chown=appuser:appuser /opt/whisper.cpp/models /models

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY --chown=appuser:appuser app /app/app

ENV WHISPER_MODEL_PATH=/models/ggml-${WHISPER_MODEL}.bin
ENV WHISPER_THREADS=1

# Ensure whisper-cli can locate libwhisper/libggml at runtime
ENV LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

RUN ldconfig

# Give appuser ownership of /app (uvicorn's cwd) and ensure the tempfile
# module can create per-request working dirs there if TMPDIR is ever
# pointed at it; /tmp itself is already world-writable (sticky bit).
RUN chown -R appuser:appuser /app

EXPOSE 9000

USER appuser

CMD ["sh", "-lc", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-9000}"]
