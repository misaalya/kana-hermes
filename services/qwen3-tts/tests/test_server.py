from __future__ import annotations

import threading
import base64
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient
import numpy as np
import soundfile as sf

from kana_qwen3_tts.config import ServiceSettings
from kana_qwen3_tts.runtime import RuntimeSnapshot
from kana_qwen3_tts.server import create_app


class FakeRuntime:
    def __init__(self, *, supports_voice_clone: bool = False) -> None:
        self.loaded = False
        self.supports_voice_clone = supports_voice_clone

    def load(self) -> None:
        self.loaded = True

    def snapshot(self) -> RuntimeSnapshot:
        return RuntimeSnapshot(
            status="ready",
            model="test-model",
            revision="test-revision",
            device="cpu",
            dtype="float32",
            speakers=() if self.supports_voice_clone else ("ono_anna", "serena"),
            languages=("japanese",),
            default_voice_id="" if self.supports_voice_clone else "ono_anna",
            supports_instruction=False,
            supports_voice_clone=self.supports_voice_clone,
            model_type="base" if self.supports_voice_clone else "custom_voice",
            loaded_seconds=0.01,
            error=None,
        )

    def synthesize(
        self,
        *,
        text: str,
        voice_id: str | None,
        voice_profile: object | None,
        emotion: str | None,
        cancel_event: threading.Event,
    ) -> tuple[np.ndarray, int]:
        del text, voice_id, voice_profile, emotion
        if cancel_event.is_set():
            raise RuntimeError("cancelled")
        return np.zeros(2400, dtype=np.float32), 24000


def settings(data_dir: Path) -> ServiceSettings:
    return ServiceSettings(
        model_id="test-model",
        model_revision="test-revision",
        device="cpu",
        dtype="float32",
        attention="eager",
        cache_dir=None,
        data_dir=data_dir,
        default_voice_id="ono_anna",
        host="127.0.0.1",
        port=7860,
        max_characters=1200,
        max_new_tokens=128,
        allowed_origin_regex=r"^https?://127\.0\.0\.1(:\d+)?$",
    )


class ServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.runtime = FakeRuntime()
        self.client_context = TestClient(
            create_app(settings(Path(self.temporary_directory.name)), self.runtime)
        )
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def test_health_and_voice_discovery(self) -> None:
        health = self.client.get("/v1/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ready")

        voices = self.client.get("/v1/voices")
        self.assertEqual(voices.status_code, 200)
        self.assertEqual(voices.json()["default_voice_id"], "ono_anna")
        self.assertEqual(len(voices.json()["voices"]), 2)

        setup = self.client.get("/v1/setup")
        self.assertEqual(setup.status_code, 200)
        self.assertEqual(setup.json()["service"], "kana-qwen3-tts")
        self.assertIsInstance(setup.json()["free_disk_bytes"], int)
        self.assertIn("disk_sufficient", setup.json())

    def test_japanese_speech_returns_wav(self) -> None:
        response = self.client.post(
            "/v1/speech",
            headers={"X-Kana-Request-Id": "test-request"},
            json={
                "text": "こんにちは。",
                "language": "ja",
                "voice_id": "ono_anna",
                "emotion": "happy",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertEqual(response.headers["x-kana-request-id"], "test-request")
        self.assertTrue(response.content.startswith(b"RIFF"))

    def test_non_japanese_input_is_rejected(self) -> None:
        response = self.client.post(
            "/v1/speech",
            json={"text": "Hello", "language": "en"},
        )
        self.assertEqual(response.status_code, 422)

    def test_voice_clone_profile_can_be_created_listed_used_and_deleted(self) -> None:
        clone_runtime = FakeRuntime(supports_voice_clone=True)
        with TestClient(
            create_app(
                settings(Path(self.temporary_directory.name) / "clone"),
                clone_runtime,
            )
        ) as client:
            audio = BytesIO()
            sf.write(audio, np.zeros(24_000, dtype=np.float32), 24_000, format="WAV")
            encoded = base64.b64encode(audio.getvalue()).decode("ascii")
            created = client.post(
                "/v1/voices/clone",
                json={
                    "name": "My permitted voice",
                    "audio_base64": encoded,
                    "reference_text": "これは参照音声の正確な文章です。",
                    "x_vector_only": False,
                    "consent": True,
                },
            )
            self.assertEqual(created.status_code, 201)
            voice_id = created.json()["voice"]["id"]

            voices = client.get("/v1/voices").json()["voices"]
            self.assertEqual(voices[0]["kind"], "cloned")
            self.assertEqual(voices[0]["id"], voice_id)

            speech = client.post(
                "/v1/speech",
                json={"text": "こんにちは。", "language": "ja", "voice_id": voice_id},
            )
            self.assertEqual(speech.status_code, 200)

            deleted = client.delete(f"/v1/voices/{voice_id}")
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(client.get("/v1/voices").json()["voices"], [])

    def test_voice_clone_requires_explicit_permission_confirmation(self) -> None:
        clone_runtime = FakeRuntime(supports_voice_clone=True)
        with TestClient(
            create_app(
                settings(Path(self.temporary_directory.name) / "consent"),
                clone_runtime,
            )
        ) as client:
            response = client.post(
                "/v1/voices/clone",
                json={
                    "name": "No consent",
                    "audio_base64": "UklGRg==",
                    "reference_text": "text",
                    "consent": False,
                },
            )
            self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
