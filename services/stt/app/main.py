import base64
import os
import re
import subprocess
import tempfile
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel


class TranscribeRequest(BaseModel):
    audio_base64: str
    mime_type: Optional[str] = None
    language: Optional[str] = None


app = FastAPI()


def _safe_language(lang: Optional[str]) -> Optional[str]:
    if not lang:
        return None
    v = lang.strip().lower()
    if re.fullmatch(r"[a-z]{2}", v):
        return v
    return None


@app.post("/v1/transcribe")
def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
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
