# Kana Qwen3-TTS service (pure-C engine)

HTTP boundary between Kana and the [pure-C Qwen3-TTS engine](https://github.com/gabriele-mastrapasqua/qwen3-tts)
(MIT, pinned commit in `scripts/setup-qwen3-tts-engine.sh`). The adapter is a
single zero-dependency Node file (`server.mjs`); inference runs in the
engine's own process — one CLI invocation per speech request — never inside
Next.js.

## Versioned API (v2)

- `GET  /v1/health`
- `GET  /v1/setup`
- `GET  /v1/voices`
- `POST /v1/voices/clone` — `{name, audio_base64, reference_text?, x_vector_only?, consent}`
- `DELETE /v1/voices?id=<id>`
- `POST /v1/speech` — `{text, language?, voice_id?} -> audio/wav`; honours
  `X-Kana-Request-Id` for cancellation via `POST /v1/requests/<id>/cancel`
  or by aborting the request.

Reference audio must be decodable WAV; non-24 kHz input is transcoded with
ffmpeg. Cloned profiles are stored as engine `.qvoice` grafts plus a sidecar
`.json` under `<KANA_TTS_DATA_DIR>/voices`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `KANA_TTS_HOST` / `KANA_TTS_PORT` | `127.0.0.1:7860` | Bind address |
| `KANA_TTS_ENGINE_DIR` | `~/.local/share/kana/qwen3-tts-engine` | Engine checkout + model dir |
| `KANA_TTS_ENGINE_BIN` | `<engine>/qwen_tts` | Explicit binary path |
| `KANA_TTS_MODEL_DIR` | `<engine>/qwen3-tts-0.6b-base` | Base model directory |
| `KANA_TTS_DATA_DIR` | `~/.local/share/kana/qwen3-tts` | Voice profiles root |
| `KANA_TTS_ENGINE_JOBS` | `2` | Engine `-j` worker threads |
| `KANA_TTS_ENGINE_QUANT` | `int8` | Runtime quantization; empty = bf16 |
| `KANA_TTS_MAX_SYNTH_SECONDS` | `300` | Hard kill guard per synthesis |

## Setup

```bash
npm run tts:setup   # clone+build engine (OpenBLAS), prepare Base model
npm run tts:dev     # start the adapter on 127.0.0.1:7860
npm run tts:test    # contract smoke test
```

Measured on the 4-vCPU EPYC reference host with `-j2 --int8`: RTF ≈ 0.92–1.0
(sub-realtime), roughly 2.4× faster than the previous PyTorch service.

Known limits: emotion instructions are not available on the 0.6B Base path
(the engine's per-clone steering distillation needs a donor workflow), so the
service reports `supports_instruction: false` exactly like the previous
PyTorch service did.
