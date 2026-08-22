# Kana Qwen3-TTS service

This is Kana's local HTTP boundary around the official `qwen-tts` Python
package. Inference stays outside the Next.js process. The versioned API is:

- `GET /v1/health`
- `GET /v1/setup`
- `GET /v1/voices`
- `POST /v1/speech`
- `POST /v1/requests/{request_id}/cancel`

The default model is the official `Qwen/Qwen3-TTS-12Hz-0.6B-Base`, pinned to a
known Hugging Face revision. The Base model speaks through cloned voice
profiles created in Kana; there are no preset speaker IDs.
`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` remains loadable via `KANA_TTS_MODEL`
for preset voices such as `ono_anna`, but its currently pinned revision does
not load with this service; unpin or re-pin a working revision first.

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
| `KANA_TTS_DTYPE` | `auto` | `float32`, `float16`, or `bfloat16`; on CPU, `auto` picks `bfloat16` when the CPU supports it and `float32` otherwise |
| `KANA_TTS_ATTENTION` | `sdpa` | Transformers attention implementation, such as `eager` |
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

## CPU performance notes

The service targets CPU hosts. Measured on a 4-vCPU AMD EPYC 9575F with 7.7 GB
RAM (`torch==2.13.0+cpu`, Base model, cloned-voice synthesis, 5 samples per
profile):

| Configuration | Short text | Medium text | Outcome |
| --- | --- | --- | --- |
| `float32` + `eager` | RTF 8.1–11.0 | killed by the OOM killer (~4.8 GB RSS) | unusable below ~16 GB RAM |
| `float32` + `sdpa` | RTF 6.2–7.6 | killed by the OOM killer | unusable below ~16 GB RAM |
| `bfloat16` + `sdpa` (new defaults) | RTF 2.4–2.5 | RTF 2.3–3.0 | completes; ~4.4 GB RSS peak |

RTF is wall-clock seconds per second of audio; lower is better. Practical
guidance:

- Prefer a host with BF16 support (recent AMD Zen 4+/Intel AVX-512-BF16) and
  at least 8 GB RAM for the 0.6B Base model.
- On CPUs without BF16, set `KANA_TTS_DTYPE=float32` explicitly if `auto`
  ever mis-detects, and expect roughly 3× slower synthesis with higher memory
  pressure; prefer 16 GB RAM in that case.
- The sentence-chunk delivery mode in Kana reduces time-to-first-audio when
  full-response latency exceeds a few seconds.

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
