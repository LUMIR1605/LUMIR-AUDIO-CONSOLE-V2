"""Local-only Polish XTTS service for LUMIR Audio Console V2.

This service intentionally binds only to 127.0.0.1. It never uploads a voice
reference or generated speech. The XTTS model is downloaded only after the
user explicitly accepts the non-commercial CPML in the local UI request.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated

import lameenc
import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse


ROOT = Path(__file__).resolve().parent
MODEL_CACHE = ROOT / "model-cache"
REFERENCE_CACHE = ROOT / "references"
OUTPUTS = ROOT / "outputs"
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
MODEL_DIRECTORY = MODEL_CACHE / "tts" / "tts_models--multilingual--multi-dataset--xtts_v2"
TOS_FILE = MODEL_DIRECTORY / "tos_agreed.txt"
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_TEXT_LENGTH = 1200

# ModelManager reads this before loading XTTS, so all large model artifacts
# remain in the ignored local-tts/model-cache directory.
os.environ.setdefault("TTS_HOME", str(MODEL_CACHE))

from TTS.api import TTS
from TTS.tts.models import xtts as xtts_model


def load_xtts_reference(audiopath: str | os.PathLike[str], sampling_rate: int) -> torch.Tensor:
    """Read only the validated local PCM reference without TorchCodec.

    Windows Application Control blocks TorchCodec's DLL on this machine. XTTS
    asks for a waveform tensor here, so soundfile plus torchaudio's in-memory
    resampler is sufficient and never modifies or uploads the reference file.
    """
    samples, source_rate = sf.read(audiopath, dtype="float32", always_2d=True)
    audio = torch.from_numpy(np.ascontiguousarray(samples.T))
    if audio.size(0) != 1:
        audio = torch.mean(audio, dim=0, keepdim=True)
    if source_rate != sampling_rate:
        audio = torchaudio.functional.resample(audio, source_rate, sampling_rate)
    return audio.clamp_(-1, 1)


# This is intentionally a process-local adapter, not a modification to Coqui.
# It preserves the public XTTS API and lets the TTS engine be replaced later.
xtts_model.load_audio = load_xtts_reference

app = FastAPI(title="LUMIR Local XTTS", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
    # Keep the service loopback-only, while permitting an isolated local
    # console instance on another development port during verification.
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_model: TTS | None = None
_model_lock = threading.RLock()


def ensure_directories() -> None:
    for directory in (MODEL_CACHE, REFERENCE_CACHE, OUTPUTS):
        directory.mkdir(parents=True, exist_ok=True)


def device_name() -> str:
    return torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"


def accept_cpml() -> None:
    """Persist acceptance only after an explicit local UI request."""
    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    TOS_FILE.write_text(
        "I have read, understood and agreed to the Terms and Conditions.\n",
        encoding="utf-8",
    )


def get_model() -> TTS:
    global _model
    with _model_lock:
        if _model is None:
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA is unavailable. Local XTTS requires the configured NVIDIA GPU.")
            _model = TTS(MODEL_NAME, progress_bar=False).to("cuda")
        return _model


def encode_mp3(source_wav: Path, destination_mp3: Path) -> None:
    samples, sample_rate = sf.read(source_wav, dtype="float32", always_2d=True)
    pcm = np.ascontiguousarray(np.clip(samples, -1, 1) * 32767, dtype="<i2")
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(pcm.shape[1])
    encoder.set_quality(2)
    destination_mp3.write_bytes(encoder.encode(pcm.tobytes()) + encoder.flush())


@app.on_event("startup")
def startup() -> None:
    ensure_directories()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "service": "lumir-local-xtts",
        "local_only": True,
        "model": "XTTS-v2",
        "language": "pl",
        "cuda_available": torch.cuda.is_available(),
        "device": device_name(),
        "model_cached": MODEL_DIRECTORY.exists(),
        "model_loaded": _model is not None,
        "cpml_accepted": TOS_FILE.exists(),
    }


@app.post("/api/tts")
async def synthesize(
    text: Annotated[str, Form()],
    voice: Annotated[UploadFile, File()],
    output_format: Annotated[str, Form()] = "wav",
    accept_cpml_terms: Annotated[bool, Form()] = False,
) -> FileResponse:
    normalized_text = text.strip()
    if not normalized_text or len(normalized_text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Text must contain 1–{MAX_TEXT_LENGTH} characters.")
    if output_format not in {"wav", "mp3"}:
        raise HTTPException(status_code=400, detail="Output format must be WAV or MP3.")
    suffix = Path(voice.filename or "reference.wav").suffix.lower()
    if suffix not in {".wav", ".mp3"}:
        raise HTTPException(status_code=400, detail="Voice reference must be WAV or MP3.")
    if not accept_cpml_terms and not TOS_FILE.exists():
        raise HTTPException(
            status_code=412,
            detail="XTTS-v2 requires explicit acceptance of the non-commercial CPML before its first download.",
        )

    reference_bytes = await voice.read(MAX_REFERENCE_BYTES + 1)
    await voice.close()
    if not reference_bytes or len(reference_bytes) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail="Voice reference must be non-empty and at most 50 MB.")

    ensure_directories()
    request_id = uuid.uuid4().hex
    reference_path = REFERENCE_CACHE / f"{request_id}{suffix}"
    wav_path = OUTPUTS / f"lumir-tts-{datetime.now():%Y%m%d-%H%M%S}-{request_id[:8]}.wav"
    reference_path.write_bytes(reference_bytes)

    try:
        if accept_cpml_terms and not TOS_FILE.exists():
            accept_cpml()
        model_was_loaded = _model is not None
        model_started = time.perf_counter()
        model = get_model()
        model_load_ms = round((time.perf_counter() - model_started) * 1000)
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        synthesis_started = time.perf_counter()
        with _model_lock:
            model.tts_to_file(
                text=normalized_text,
                speaker_wav=str(reference_path),
                language="pl",
                file_path=str(wav_path),
                split_sentences=True,
            )
        synthesis_ms = round((time.perf_counter() - synthesis_started) * 1000)
        output_path = wav_path
        media_type = "audio/wav"
        if output_format == "mp3":
            output_path = wav_path.with_suffix(".mp3")
            encode_mp3(wav_path, output_path)
            wav_path.unlink(missing_ok=True)
            media_type = "audio/mpeg"
        headers = {
            "X-Lumir-TTS-Model-Was-Loaded": str(model_was_loaded).lower(),
            "X-Lumir-TTS-Model-Load-Ms": str(model_load_ms),
            "X-Lumir-TTS-Synthesis-Ms": str(synthesis_ms),
        }
        if torch.cuda.is_available():
            headers.update({
                "X-Lumir-TTS-Vram-Allocated-MiB": f"{torch.cuda.memory_allocated() / 1024 ** 2:.1f}",
                "X-Lumir-TTS-Vram-Reserved-MiB": f"{torch.cuda.memory_reserved() / 1024 ** 2:.1f}",
                "X-Lumir-TTS-Vram-Peak-Allocated-MiB": f"{torch.cuda.max_memory_allocated() / 1024 ** 2:.1f}",
            })
        return FileResponse(output_path, media_type=media_type, filename=output_path.name, headers=headers)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Local XTTS failed: {error}") from error
    finally:
        reference_path.unlink(missing_ok=True)
