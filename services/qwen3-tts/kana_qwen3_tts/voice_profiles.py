from __future__ import annotations

import base64
import binascii
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from io import BytesIO
import json
import os
from pathlib import Path
import re
from uuid import uuid4

import numpy as np
import soundfile as sf


PROFILE_ID = re.compile(r"^clone-[a-f0-9]{32}$")
MAX_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024
MIN_REFERENCE_SECONDS = 1.0
MAX_REFERENCE_SECONDS = 30.0


@dataclass(frozen=True, slots=True)
class VoiceProfile:
    id: str
    name: str
    audio_path: Path
    reference_text: str | None
    x_vector_only: bool
    duration_seconds: float
    created_at: str

    def descriptor(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "language": "multi",
            "kind": "cloned",
            "duration_seconds": self.duration_seconds,
            "created_at": self.created_at,
            "x_vector_only": self.x_vector_only,
        }


class VoiceProfileStore:
    def __init__(self, data_dir: Path) -> None:
        self.root = data_dir.expanduser().resolve() / "voices"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def list(self) -> list[VoiceProfile]:
        profiles: list[VoiceProfile] = []
        for metadata_path in sorted(self.root.glob("clone-*.json")):
            try:
                profile = self._read(metadata_path.stem)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            profiles.append(profile)
        return sorted(profiles, key=lambda profile: profile.created_at)

    def get(self, profile_id: str) -> VoiceProfile | None:
        if not PROFILE_ID.fullmatch(profile_id):
            return None
        try:
            return self._read(profile_id)
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
            return None

    def create(
        self,
        *,
        name: str,
        audio_base64: str,
        reference_text: str | None,
        x_vector_only: bool,
    ) -> VoiceProfile:
        clean_name = " ".join(name.split()).strip()
        if not clean_name or len(clean_name) > 80:
            raise ValueError("Voice name must contain between 1 and 80 characters")
        clean_text = " ".join((reference_text or "").split()).strip() or None
        if not x_vector_only and not clean_text:
            raise ValueError(
                "An exact transcript of the reference audio is required for high-quality cloning"
            )
        if clean_text and len(clean_text) > 2000:
            raise ValueError("Reference transcript must be 2,000 characters or fewer")

        encoded = audio_base64.split(",", 1)[-1]
        try:
            audio_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Reference audio is not valid base64 data") from error
        if not audio_bytes or len(audio_bytes) > MAX_REFERENCE_AUDIO_BYTES:
            raise ValueError("Reference audio must be between 1 byte and 20 MB")

        try:
            waveform, sample_rate = sf.read(
                BytesIO(audio_bytes), dtype="float32", always_2d=True
            )
        except Exception as error:
            raise ValueError(
                "Reference audio could not be decoded; use WAV, FLAC, or OGG"
            ) from error
        if sample_rate < 8_000 or sample_rate > 192_000 or waveform.size == 0:
            raise ValueError("Reference audio has an unsupported sample rate or is empty")
        duration = waveform.shape[0] / sample_rate
        if duration < MIN_REFERENCE_SECONDS or duration > MAX_REFERENCE_SECONDS:
            raise ValueError("Reference audio must be between 1 and 30 seconds long")
        mono = np.mean(waveform, axis=1)
        if not np.isfinite(mono).all():
            raise ValueError("Reference audio contains invalid samples")

        profile_id = f"clone-{uuid4().hex}"
        audio_path = self.root / f"{profile_id}.wav"
        metadata_path = self.root / f"{profile_id}.json"
        audio_temp = self.root / f".{profile_id}.wav.tmp"
        metadata_temp = self.root / f".{profile_id}.json.tmp"
        created_at = datetime.now(UTC).isoformat()
        profile = VoiceProfile(
            id=profile_id,
            name=clean_name,
            audio_path=audio_path,
            reference_text=clean_text,
            x_vector_only=x_vector_only,
            duration_seconds=round(duration, 3),
            created_at=created_at,
        )
        try:
            sf.write(audio_temp, mono, sample_rate, format="WAV", subtype="PCM_16")
            os.chmod(audio_temp, 0o600)
            metadata = {
                **asdict(profile),
                "audio_path": audio_path.name,
            }
            metadata_temp.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.chmod(metadata_temp, 0o600)
            audio_temp.replace(audio_path)
            metadata_temp.replace(metadata_path)
        except Exception:
            audio_temp.unlink(missing_ok=True)
            metadata_temp.unlink(missing_ok=True)
            audio_path.unlink(missing_ok=True)
            raise
        return profile

    def delete(self, profile_id: str) -> bool:
        if not PROFILE_ID.fullmatch(profile_id):
            return False
        removed = False
        for suffix in (".json", ".wav"):
            target = self.root / f"{profile_id}{suffix}"
            if target.exists():
                target.unlink()
                removed = True
        return removed

    def _read(self, profile_id: str) -> VoiceProfile:
        if not PROFILE_ID.fullmatch(profile_id):
            raise ValueError("Invalid voice profile ID")
        metadata_path = self.root / f"{profile_id}.json"
        value = json.loads(metadata_path.read_text(encoding="utf-8"))
        audio_name = value.get("audio_path")
        if audio_name != f"{profile_id}.wav":
            raise ValueError("Voice profile contains an invalid audio path")
        audio_path = self.root / audio_name
        if not audio_path.is_file():
            raise ValueError("Voice profile audio is missing")
        return VoiceProfile(
            id=profile_id,
            name=str(value["name"]),
            audio_path=audio_path,
            reference_text=(
                str(value["reference_text"])
                if value.get("reference_text")
                else None
            ),
            x_vector_only=bool(value.get("x_vector_only", False)),
            duration_seconds=float(value["duration_seconds"]),
            created_at=str(value["created_at"]),
        )
