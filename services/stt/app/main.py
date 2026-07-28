import base64
import hmac
import os
import re
import subprocess
import tempfile
import threading
import time
from collections import defaultdict, deque
from typing import Dict, Deque, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Request
from pydantic import BaseModel


class TranscribeRequest(BaseModel):
    audio_base64: str
    mime_type: Optional[str] = None
    language: Optional[str] = None


app = FastAPI()


# --------------------------------------------------------------------------
# Auth: shared-secret bearer token.
#
# This service is only meant to be called by trusted internal backends
# (e.g. services/ai-orchestrator, services/api) and is internet-reachable
# in production, so every route that does real work must require a
# bearer token matching STT_SHARED_SECRET, checked in constant time.
# --------------------------------------------------------------------------

STT_SHARED_SECRET = os.environ.get("STT_SHARED_SECRET", "")


def _require_auth(authorization: Optional[str]) -> None:
    if not STT_SHARED_SECRET:
        # Fail closed: if no secret is configured, refuse rather than
        # silently accepting unauthenticated traffic.
        raise HTTPException(status_code=503, detail="Service not configured")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[len("Bearer "):].strip()

    if not hmac.compare_digest(token, STT_SHARED_SECRET):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# --------------------------------------------------------------------------
# Rate limiting: minimal in-memory sliding window, keyed by client IP.
#
# This is a single-instance service with no Redis wired in, so a simple
# in-process limiter is enough to blunt cheap DoS / cost-abuse against the
# expensive ffmpeg + whisper-cli pipeline (up to ~120s CPU per request).
# --------------------------------------------------------------------------

STT_RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("STT_RATE_LIMIT_MAX_REQUESTS", "10"))
STT_RATE_LIMIT_WINDOW_SECONDS = float(os.environ.get("STT_RATE_LIMIT_WINDOW_SECONDS", "60"))

_rate_limit_lock = threading.Lock()
_rate_limit_hits: Dict[str, Deque[float]] = defaultdict(deque)


def _check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    cutoff = now - STT_RATE_LIMIT_WINDOW_SECONDS

    with _rate_limit_lock:
        hits = _rate_limit_hits[client_ip]

        while hits and hits[0] < cutoff:
            hits.popleft()

        if len(hits) >= STT_RATE_LIMIT_MAX_REQUESTS:
            raise HTTPException(status_code=429, detail="Too many requests")

        hits.append(now)


def _safe_language(lang: Optional[str]) -> Optional[str]:
    if not lang:
        return None
    v = lang.strip().lower()
    if re.fullmatch(r"[a-z]{2}", v):
        return v
    return None


@app.post("/v1/transcribe")
def transcribe(
    request: Request,
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    _require_auth(authorization)

    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    if not file:
        raise HTTPException(status_code=400, detail="Missing file")

    try:
        audio_bytes = file.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    model_path = os.environ.get("WHISPER_MODEL_PATH") or "/models/ggml-base.bin"
    if not os.path.exists(model_path):
        raise HTTPException(status_code=500, detail=f"Model not found at {model_path}")

    threads = os.environ.get("WHISPER_THREADS") or "4"
    safe_language = _safe_language(language)

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.m4a")
        wav_path = os.path.join(tmp, "audio.wav")
        out_prefix = os.path.join(tmp, "out")
        out_txt = out_prefix + ".txt"

        with open(in_path, "wb") as f:
            f.write(audio_bytes)

        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    in_path,
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    wav_path,
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="ffmpeg timeout")
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=400, detail=f"ffmpeg failed: {e.stderr.decode(errors='ignore')}")

        cmd = [
            "whisper-cli",
            "-m",
            model_path,
            "-f",
            wav_path,
            "-nt",
            "-otxt",
            "-of",
            out_prefix,
            "-t",
            str(threads),
        ]

        if safe_language:
            cmd.extend(["-l", safe_language])

        try:
            subprocess.run(
                cmd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="whisper timeout")
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=500, detail=f"whisper failed: {e.stderr.decode(errors='ignore')}")

        try:
            with open(out_txt, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read().strip()
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="Whisper output not found")

        if not text:
            raise HTTPException(status_code=422, detail="Empty transcription")

        return {"text": text, "language": safe_language or "auto"}
