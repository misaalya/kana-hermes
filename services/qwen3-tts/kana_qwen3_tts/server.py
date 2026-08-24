from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from io import BytesIO
import threading
import time
from typing import Any, AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
import soundfile as sf

from . import API_VERSION, SERVICE_NAME
from .config import ServiceSettings, setup_snapshot
from .runtime import (
    Qwen3TTSRuntime,
    RuntimeNotReadyError,
    SynthesisCancelledError,
)
from .voice_profiles import VoiceProfileStore


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    language: str = "ja"
    voice_id: str | None = None
    emotion: str | None = None


class CloneVoiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    audio_base64: str = Field(min_length=1)
    reference_text: str | None = Field(default=None, max_length=2000)
    x_vector_only: bool = False
    consent: bool = False


class CancelRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, tuple[threading.Event, float]] = {}

    def begin(self, request_id: str) -> threading.Event:
        with self._lock:
            self._purge_locked()
            existing = self._requests.get(request_id)
            if existing is not None:
                return existing[0]
            event = threading.Event()
            self._requests[request_id] = (event, time.monotonic())
            return event

    def cancel(self, request_id: str) -> bool:
        with self._lock:
            self._purge_locked()
            existing = self._requests.get(request_id)
            if existing is None:
                event = threading.Event()
                event.set()
                self._requests[request_id] = (event, time.monotonic())
                return False
            existing[0].set()
            return True

    def finish(self, request_id: str) -> None:
        with self._lock:
            self._requests.pop(request_id, None)

    def _purge_locked(self) -> None:
        cutoff = time.monotonic() - 300
        stale = [key for key, (_, created) in self._requests.items() if created < cutoff]
        for key in stale:
            self._requests.pop(key, None)


def create_app(
    settings: ServiceSettings | None = None,
    runtime: Qwen3TTSRuntime | None = None,
) -> FastAPI:
    service_settings = settings or ServiceSettings.from_environment()
    service_runtime = runtime or Qwen3TTSRuntime(service_settings)
    voice_profiles = VoiceProfileStore(service_settings.data_dir)
    cancels = CancelRegistry()
    inference_lock = asyncio.Lock()

    async def load_runtime() -> None:
        try:
            await asyncio.to_thread(service_runtime.load)
        except Exception:
            # RuntimeSnapshot carries the sanitized load error for /v1/health.
            return

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        load_task = asyncio.create_task(load_runtime())
        yield
        if not load_task.done():
            load_task.cancel()
        with suppress(asyncio.CancelledError):
            await load_task

    app = FastAPI(
        title="Kana Qwen3-TTS",
        version=API_VERSION,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=service_settings.allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Kana-Request-Id"],
        expose_headers=[
            "X-Kana-Request-Id",
            "X-Kana-Sample-Rate",
            "X-Kana-Voice-Id",
        ],
    )

    @app.get("/")
    async def service_info() -> dict[str, str]:
        return {
            "service": SERVICE_NAME,
            "api_version": API_VERSION,
            "health": "/v1/health",
        }

    @app.get("/v1/health")
    async def health() -> dict[str, Any]:
        return {
            "service": SERVICE_NAME,
            "api_version": API_VERSION,
            **service_runtime.snapshot().to_dict(),
        }

    @app.get("/v1/setup")
    async def setup() -> dict[str, Any]:
        return {
            "service": SERVICE_NAME,
            "api_version": API_VERSION,
            **setup_snapshot(service_settings),
        }

    @app.get("/v1/voices")
    async def voices() -> dict[str, Any]:
        snapshot = service_runtime.snapshot()
        return {
            "service": SERVICE_NAME,
            "api_version": API_VERSION,
            "status": snapshot.status,
            "default_voice_id": (
                snapshot.default_voice_id
                or next(
                    (profile.id for profile in voice_profiles.list()), ""
                )
            ),
            "supports_voice_clone": snapshot.supports_voice_clone,
            "voices": [
                {
                    "id": voice_id,
                    "name": voice_id.replace("_", " ").title(),
                    "language": "multi",
                    "kind": "preset",
                }
                for voice_id in snapshot.speakers
            ]
            + (
                [profile.descriptor() for profile in voice_profiles.list()]
                if snapshot.supports_voice_clone
                else []
            ),
        }

    @app.post("/v1/voices/clone", status_code=201)
    async def clone_voice(payload: CloneVoiceRequest) -> dict[str, Any]:
        snapshot = service_runtime.snapshot()
        if not snapshot.supports_voice_clone:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Voice cloning requires a Qwen3-TTS Base checkpoint. "
                    f"The current model type is {snapshot.model_type}."
                ),
            )
        if not payload.consent:
            raise HTTPException(
                status_code=422,
                detail="Confirm that you have permission to clone this voice.",
            )
        try:
            profile = voice_profiles.create(
                name=payload.name,
                audio_base64=payload.audio_base64,
                reference_text=payload.reference_text,
                x_vector_only=payload.x_vector_only,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {
            "service": SERVICE_NAME,
            "api_version": API_VERSION,
            "voice": profile.descriptor(),
        }

    @app.delete("/v1/voices/{voice_id}")
    async def delete_voice(voice_id: str) -> dict[str, Any]:
        if not voice_profiles.delete(voice_id):
            raise HTTPException(status_code=404, detail="Cloned voice was not found")
        return {"voice_id": voice_id, "deleted": True}

    @app.post("/v1/requests/{request_id}/cancel")
    async def cancel(request_id: str) -> dict[str, Any]:
        was_active = cancels.cancel(request_id)
        return {"request_id": request_id, "cancelled": True, "was_active": was_active}

    @app.post("/v1/speech")
    async def speech(payload: SpeechRequest, request: Request) -> Response:
        snapshot = service_runtime.snapshot()
        if snapshot.status != "ready":
            detail = "Qwen3-TTS model is still loading"
            if snapshot.status == "error":
                detail = snapshot.error or "Qwen3-TTS failed to load"
            raise HTTPException(status_code=503, detail=detail)
        if payload.language.strip().lower() not in {"ja", "japanese"}:
            raise HTTPException(
                status_code=422,
                detail="Kana's Qwen3-TTS endpoint accepts Japanese speech only",
            )
        if len(payload.text) > service_settings.max_characters:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Text exceeds the {service_settings.max_characters} character limit"
                ),
            )

        voice_profile = (
            voice_profiles.get(payload.voice_id)
            if payload.voice_id and snapshot.supports_voice_clone
            else None
        )
        if snapshot.supports_voice_clone and voice_profile is None:
            # Fall back to the configured/default cloned voice so a request
            # without an explicit voice_id still speaks (Kana sends one from
            # preferences, but the default keeps the service usable directly).
            fallback_id = snapshot.default_voice_id or (
                voice_profiles.list()[0].id if voice_profiles.list() else None
            )
            voice_profile = voice_profiles.get(fallback_id) if fallback_id else None
        if snapshot.supports_voice_clone and voice_profile is None:
            raise HTTPException(
                status_code=422,
                detail="Select or create a cloned voice before speaking.",
            )
        request_id = request.headers.get("X-Kana-Request-Id") or str(uuid4())
        cancel_event = cancels.begin(request_id)
        try:
            async with inference_lock:
                if cancel_event.is_set():
                    raise SynthesisCancelledError("Synthesis was cancelled")
                synthesis = asyncio.create_task(
                    asyncio.to_thread(
                        service_runtime.synthesize,
                        text=payload.text,
                        voice_id=payload.voice_id,
                        voice_profile=voice_profile,
                        emotion=payload.emotion,
                        cancel_event=cancel_event,
                    )
                )
                while not synthesis.done():
                    await asyncio.wait({synthesis}, timeout=0.1)
                    if await request.is_disconnected():
                        cancel_event.set()
                waveform, sample_rate = await synthesis
        except asyncio.CancelledError:
            cancel_event.set()
            raise
        except RuntimeNotReadyError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except SynthesisCancelledError as error:
            raise HTTPException(status_code=499, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=f"Qwen3-TTS synthesis failed: {type(error).__name__}: {error}",
            ) from error
        finally:
            cancels.finish(request_id)

        output = BytesIO()
        sf.write(output, waveform, sample_rate, format="WAV", subtype="PCM_16")
        return Response(
            content=output.getvalue(),
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "X-Kana-Request-Id": request_id,
                "X-Kana-Sample-Rate": str(sample_rate),
                "X-Kana-Voice-Id": (
                    payload.voice_id or snapshot.default_voice_id or "unselected"
                ).lower(),
            },
        )

    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = ServiceSettings.from_environment()
    uvicorn.run(
        "kana_qwen3_tts.server:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )
