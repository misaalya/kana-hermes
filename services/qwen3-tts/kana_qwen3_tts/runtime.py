from __future__ import annotations

from dataclasses import asdict, dataclass
import os
import threading
import time
from typing import Any

import numpy as np

from .config import ServiceSettings
from .voice_profiles import VoiceProfile


EMOTION_INSTRUCTIONS = {
    "neutral": "Speak naturally in a calm, conversational tone.",
    "happy": "Speak cheerfully and warmly.",
    "sad": "Speak softly with restrained sadness.",
    "angry": "Speak with controlled anger, without shouting.",
    "surprised": "Speak with clear, pleasant surprise.",
    "thinking": "Speak thoughtfully with gentle pauses.",
    "confused": "Speak with mild, curious uncertainty.",
    "excited": "Speak energetically and enthusiastically.",
}


class RuntimeNotReadyError(RuntimeError):
    pass


class SynthesisCancelledError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    status: str
    model: str
    revision: str | None
    device: str
    dtype: str
    speakers: tuple[str, ...]
    languages: tuple[str, ...]
    default_voice_id: str
    supports_instruction: bool
    supports_voice_clone: bool
    model_type: str
    loaded_seconds: float | None
    error: str | None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["speakers"] = list(self.speakers)
        value["languages"] = list(self.languages)
        return value


class Qwen3TTSRuntime:
    def __init__(self, settings: ServiceSettings) -> None:
        self.settings = settings
        self._state_lock = threading.RLock()
        self._load_lock = threading.Lock()
        self._model: Any | None = None
        self._torch: Any | None = None
        self._status = "loading"
        self._error: str | None = None
        self._speakers: tuple[str, ...] = ()
        self._languages: tuple[str, ...] = ()
        self._loaded_seconds: float | None = None
        self._dtype_label = settings.dtype
        model_name = settings.model_id.lower()
        self._model_type = (
            "base"
            if "-base" in model_name
            else "voice_design"
            if "voicedesign" in model_name
            else "custom_voice"
        )
        self._supports_instruction = (
            self._model_type == "custom_voice" and "0.6b" not in model_name
        )

    def load(self) -> None:
        with self._load_lock:
            if self._model is not None:
                return
            with self._state_lock:
                self._status = "loading"
                self._error = None

            started = time.monotonic()
            try:
                hub_cache = None
                if self.settings.cache_dir is not None:
                    cache_root = self.settings.cache_dir
                    hub_cache = cache_root / "hub"
                    hub_cache.mkdir(parents=True, exist_ok=True)
                    # These must be set before qwen_tts imports Hugging Face.
                    # Its nested tokenizer loader resolves the cache again.
                    os.environ["HF_HOME"] = str(cache_root)
                    os.environ["HF_HUB_CACHE"] = str(hub_cache)
                    os.environ["HUGGINGFACE_HUB_CACHE"] = str(hub_cache)

                import torch
                from qwen_tts import Qwen3TTSModel

                dtype = self._resolve_dtype(torch)
                options: dict[str, Any] = {
                    "device_map": self.settings.device,
                    "dtype": dtype,
                    "attn_implementation": self.settings.attention,
                }
                if hub_cache is not None:
                    options["cache_dir"] = str(hub_cache)
                if self.settings.model_revision is not None:
                    options["revision"] = self.settings.model_revision

                model = Qwen3TTSModel.from_pretrained(
                    self.settings.model_id,
                    **options,
                )
                speakers = tuple(
                    str(value).lower()
                    for value in (model.get_supported_speakers() or [])
                )
                languages = tuple(
                    str(value).lower()
                    for value in (model.get_supported_languages() or [])
                )
                default_voice = self.settings.default_voice_id
                if speakers and default_voice not in speakers:
                    default_voice = speakers[0]
                model_type = str(
                    getattr(model.model, "tts_model_type", self._model_type)
                ).lower()

                with self._state_lock:
                    self._model = model
                    self._torch = torch
                    self._speakers = speakers
                    self._languages = languages
                    self._default_voice_id = default_voice
                    self._model_type = model_type
                    self._supports_instruction = (
                        model_type == "custom_voice"
                        and "0.6b" not in self.settings.model_id.lower()
                    )
                    self._loaded_seconds = time.monotonic() - started
                    self._status = "ready"
            except Exception as error:
                with self._state_lock:
                    self._status = "error"
                    self._error = f"{type(error).__name__}: {error}"
                raise

    def snapshot(self) -> RuntimeSnapshot:
        with self._state_lock:
            return RuntimeSnapshot(
                status=self._status,
                model=self.settings.model_id,
                revision=self.settings.model_revision,
                device=self.settings.device,
                dtype=self._dtype_label,
                speakers=self._speakers,
                languages=self._languages,
                default_voice_id=getattr(
                    self, "_default_voice_id", self.settings.default_voice_id
                ),
                supports_instruction=self._supports_instruction,
                supports_voice_clone=self._model_type == "base",
                model_type=self._model_type,
                loaded_seconds=self._loaded_seconds,
                error=self._error,
            )

    def synthesize(
        self,
        *,
        text: str,
        voice_id: str | None,
        voice_profile: VoiceProfile | None,
        emotion: str | None,
        cancel_event: threading.Event,
    ) -> tuple[np.ndarray, int]:
        with self._state_lock:
            model = self._model
            torch = self._torch
            status = self._status
            speakers = self._speakers
            default_voice = getattr(
                self, "_default_voice_id", self.settings.default_voice_id
            )
            model_type = self._model_type

        if model is None or torch is None or status != "ready":
            raise RuntimeNotReadyError("Qwen3-TTS is not ready")

        if cancel_event.is_set():
            raise SynthesisCancelledError("Synthesis was cancelled")

        if model_type == "base":
            if voice_profile is None:
                raise ValueError(
                    "The Base model requires a cloned voice profile. Create one in Kana voice settings first."
                )
            generation_method = model.generate_voice_clone
            generation_options: dict[str, Any] = {
                "text": text,
                "language": "Japanese",
                "ref_audio": str(voice_profile.audio_path),
                "ref_text": voice_profile.reference_text,
                "x_vector_only_mode": voice_profile.x_vector_only,
                "max_new_tokens": self.settings.max_new_tokens,
            }
        elif model_type == "custom_voice":
            speaker = (voice_id or default_voice).strip().lower()
            if not speaker:
                raise ValueError("A preset Qwen3-TTS voice must be selected")
            if speakers and speaker not in speakers:
                raise ValueError(
                    f"Unsupported voice '{speaker}'. Available voices: {', '.join(speakers)}"
                )
            generation_method = model.generate_custom_voice
            generation_options = {
                "text": text,
                "language": "Japanese",
                "speaker": speaker,
                "max_new_tokens": self.settings.max_new_tokens,
            }
            if self._supports_instruction and emotion:
                generation_options["instruct"] = EMOTION_INSTRUCTIONS.get(
                    emotion.lower(), EMOTION_INSTRUCTIONS["neutral"]
                )
        else:
            raise ValueError(
                f"Qwen3-TTS model type '{model_type}' cannot synthesize Kana voice"
            )

        # qwen-tts 0.1.1 documents arbitrary Transformers kwargs but its outer
        # generate method currently drops stopping_criteria. Inject it at the
        # resident talker boundary without modifying the installed package.
        from transformers import StoppingCriteria, StoppingCriteriaList

        class CancellationCriteria(StoppingCriteria):
            def __call__(self, input_ids: Any, scores: Any, **_: Any) -> Any:
                return torch.full(
                    (input_ids.shape[0],),
                    cancel_event.is_set(),
                    dtype=torch.bool,
                    device=input_ids.device,
                )

        talker = model.model.talker
        original_generate = talker.generate

        def cancellable_generate(*args: Any, **kwargs: Any) -> Any:
            existing = kwargs.get("stopping_criteria")
            criteria = StoppingCriteriaList(list(existing or []))
            criteria.append(CancellationCriteria())
            kwargs["stopping_criteria"] = criteria
            return original_generate(*args, **kwargs)

        talker.generate = cancellable_generate
        try:
            try:
                waves, sample_rate = generation_method(**generation_options)
            except Exception as error:
                if cancel_event.is_set():
                    raise SynthesisCancelledError(
                        "Synthesis was cancelled"
                    ) from error
                raise
        finally:
            talker.generate = original_generate
        if cancel_event.is_set():
            raise SynthesisCancelledError("Synthesis was cancelled")
        if not waves:
            raise RuntimeError("Qwen3-TTS returned no waveform")
        return np.asarray(waves[0], dtype=np.float32), int(sample_rate)

    def _resolve_dtype(self, torch: Any) -> Any:
        requested = self.settings.dtype
        if requested == "auto":
            requested = "float32" if self.settings.device == "cpu" else "float16"
        choices = {
            "float32": torch.float32,
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
        }
        if requested not in choices:
            raise ValueError(
                "KANA_TTS_DTYPE must be auto, float32, float16, or bfloat16"
            )
        self._dtype_label = requested
        return choices[requested]
