FROM ubuntu:22.04 AS builder

ARG WHISPER_CPP_REF=master
ARG WHISPER_MODEL=base

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

# Collect shared libs required by whisper-cli (Render runtime currently misses libwhisper.so.1)
RUN mkdir -p /deps && \
    find /opt/whisper.cpp/build -type f \( -name 'libwhisper.so*' -o -name 'libggml.so*' \) -exec cp -v '{}' /deps/ \; || true

RUN ./models/download-ggml-model.sh ${WHISPER_MODEL}


FROM python:3.11-slim-bookworm

ARG WHISPER_MODEL=base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /deps/ /usr/local/lib/
COPY --from=builder /opt/whisper.cpp/models /models

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

ENV WHISPER_MODEL_PATH=/models/ggml-${WHISPER_MODEL}.bin
ENV WHISPER_THREADS=4

# Ensure whisper-cli can locate libwhisper/libggml at runtime
ENV LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

RUN ldconfig

EXPOSE 9000

CMD ["sh", "-lc", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-9000}"]
