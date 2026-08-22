# Kana Qwen3-TTS service

This is Kana's local HTTP boundary around the official `qwen-tts` Python
package. Inference stays outside the Next.js process. The versioned API is:

- `GET /v1/health`
- `GET /v1/setup`
- `GET /v1/voices`
- `POST /v1/speech`
- `POST /v1/requests/{request_id}/cancel`

The default model is the official
`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`, pinned to a known Hugging Face
revision. It supports Japanese with the built-in `ono_anna` voice.

## Install and run

Install [`uv`](https://docs.astral.sh/uv/) first, then choose a model cache on
a filesystem with at least 4 GB free. The target development machine does not
have enough VRAM for this model, so the lockfile uses CPU-only PyTorch.

```bash
export KANA_TTS_RUNTIME_DIR=/path/with/free/space/qwen3-tts-runtime
export KANA_TTS_CACHE_DIR=/path/with/free/space/qwen3-tts-cache
UV_PROJECT_ENVIRONMENT="$KANA_TTS_RUNTIME_DIR" \
  uv run --project services/qwen3-tts kana-qwen3-tts
```

The first start downloads about 2.3 GB. The server binds to `127.0.0.1:7860`
and only permits browser origins on `127.0.0.1` or `localhost` by default.
`GET /v1/setup` is safe to call before the model finishes loading and reports
the effective cache location, whether the pinned model is already present,
and free disk space. It does not load the model or run inference.

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `KANA_TTS_CACHE_DIR` | Hugging Face default | Cache root; model files are stored below `hub/` |
| `KANA_TTS_DEVICE` | `cpu` | Torch device, such as `cuda:0` |
| `KANA_TTS_DTYPE` | `auto` | `float32`, `float16`, or `bfloat16` |
| `KANA_TTS_MODEL` | official 0.6B CustomVoice | Model ID or local path |
| `KANA_TTS_MODEL_REVISION` | pinned revision | Model revision; empty disables pinning |
| `KANA_TTS_DEFAULT_VOICE` | `ono_anna` | Default Qwen speaker |
| `KANA_TTS_HOST` | `127.0.0.1` | Bind host |
| `KANA_TTS_PORT` | `7860` | Bind port |

The 0.6B CustomVoice model does not implement instruction-based emotion
control. Kana still sends the emotion field, and the service reports
`supports_instruction: false`. Switching to a compatible 1.7B CustomVoice
model enables the service's emotion-to-instruction mapping but requires much
more memory.

## Checks

```bash
UV_PROJECT_ENVIRONMENT="$KANA_TTS_RUNTIME_DIR" \
  uv run --project services/qwen3-tts \
  python -m unittest discover -s services/qwen3-tts/tests
```

After the service is ready on target hardware, run the source repository's
`npm run tts:acceptance` command. It validates the browser/service contract,
collects short/medium/long p50 and p95 latency evidence, and exercises active
cancellation without adding Python dependencies. The complete procedure and
success criteria are in `docs/QWEN3_TTS_VPS_ACCEPTANCE.md`.
