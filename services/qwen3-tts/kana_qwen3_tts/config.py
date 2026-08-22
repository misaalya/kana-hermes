from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
from typing import Any


DEFAULT_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
DEFAULT_MODEL_REVISION = "5d83992436eae1d760afd27aff78a71d676296fc"
DEFAULT_VOICE_ID = ""
RECOMMENDED_FREE_DISK_BYTES = 4 * 1024 * 1024 * 1024


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    model_id: str
    model_revision: str | None
    device: str
    dtype: str
    attention: str
    cache_dir: Path | None
    data_dir: Path
    default_voice_id: str
    host: str
    port: int
    max_characters: int
    max_new_tokens: int
    allowed_origin_regex: str

    @classmethod
    def from_environment(cls) -> "ServiceSettings":
        cache_value = os.getenv("KANA_TTS_CACHE_DIR", "").strip()
        data_value = os.getenv(
            "KANA_TTS_DATA_DIR", "~/.local/share/kana/qwen3-tts"
        ).strip()
        revision = os.getenv(
            "KANA_TTS_MODEL_REVISION", DEFAULT_MODEL_REVISION
        ).strip()
        return cls(
            model_id=os.getenv("KANA_TTS_MODEL", DEFAULT_MODEL_ID).strip(),
            model_revision=revision or None,
            # CPU is deliberate: the target machine's 2 GB MX330 cannot hold
            # this model. Users with a suitable CUDA runtime can override it.
            device=os.getenv("KANA_TTS_DEVICE", "cpu").strip(),
            dtype=os.getenv("KANA_TTS_DTYPE", "auto").strip().lower(),
            attention=os.getenv("KANA_TTS_ATTENTION", "eager").strip(),
            cache_dir=Path(cache_value).expanduser() if cache_value else None,
            data_dir=Path(data_value).expanduser(),
            default_voice_id=os.getenv(
                "KANA_TTS_DEFAULT_VOICE", DEFAULT_VOICE_ID
            ).strip().lower(),
            host=os.getenv("KANA_TTS_HOST", "127.0.0.1").strip(),
            port=_positive_int("KANA_TTS_PORT", 7860),
            max_characters=_positive_int("KANA_TTS_MAX_CHARACTERS", 1200),
            max_new_tokens=_positive_int("KANA_TTS_MAX_NEW_TOKENS", 2048),
            allowed_origin_regex=os.getenv(
                "KANA_TTS_ALLOWED_ORIGIN_REGEX",
                r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
            ),
        )


def setup_snapshot(settings: ServiceSettings) -> dict[str, Any]:
    configured_root = settings.cache_dir
    if configured_root is not None:
        cache_root = configured_root.expanduser()
        hub_root = cache_root / "hub"
    else:
        hf_home = Path(
            os.getenv("HF_HOME", "~/.cache/huggingface")
        ).expanduser()
        cache_root = hf_home
        hub_root = Path(os.getenv("HF_HUB_CACHE", str(hf_home / "hub"))).expanduser()

    disk_probe = cache_root
    while not disk_probe.exists() and disk_probe != disk_probe.parent:
        disk_probe = disk_probe.parent
    usage = shutil.disk_usage(disk_probe)

    model_path = Path(settings.model_id).expanduser()
    if model_path.exists():
        model_cache_detected = model_path.is_dir()
    else:
        model_slug = f"models--{settings.model_id.replace('/', '--')}"
        model_root = hub_root / model_slug
        revision_path = (
            model_root / "snapshots" / settings.model_revision
            if settings.model_revision
            else model_root / "snapshots"
        )
        model_cache_detected = revision_path.exists()

    return {
        "cache_dir": str(cache_root),
        "cache_exists": cache_root.exists(),
        "model_cache_detected": model_cache_detected,
        "free_disk_bytes": usage.free,
        "total_disk_bytes": usage.total,
        "recommended_free_disk_bytes": RECOMMENDED_FREE_DISK_BYTES,
        "disk_sufficient": usage.free >= RECOMMENDED_FREE_DISK_BYTES,
    }
