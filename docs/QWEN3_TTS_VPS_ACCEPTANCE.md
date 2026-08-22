# Qwen3-TTS VPS acceptance

Use this on the target VPS or workstation. The current development machine was
not used for heavy inference because its available GPU memory and local disk
are below the practical target. Passing browser contract tests does not count
as passing real synthesis.

## 1. Prepare isolated storage

From the Kana repository:

```bash
export KANA_TTS_RUNTIME_DIR=/srv/kana/qwen3-tts-runtime
export KANA_TTS_CACHE_DIR=/srv/kana/qwen3-tts-cache
export KANA_TTS_DEVICE=cpu
UV_PROJECT_ENVIRONMENT="$KANA_TTS_RUNTIME_DIR" \
  uv run --project services/qwen3-tts kana-qwen3-tts
```

Use `KANA_TTS_DEVICE=cuda:0` only when the installed PyTorch build and GPU are
compatible. Kana's checked lock currently selects CPU-only PyTorch; a CUDA
deployment should use a separately reviewed lock/environment rather than
silently changing the web package.

Expected startup: the HTTP server listens on `127.0.0.1:7860`; first start may
download roughly 2.3 GB; health can report `loading` until model load finishes.

## 2. Check setup without inference

```bash
curl -s http://127.0.0.1:7860/v1/setup | python -m json.tool
curl -s http://127.0.0.1:7860/v1/health | python -m json.tool
curl -s http://127.0.0.1:7860/v1/voices | python -m json.tool
```

Success criteria:

- service is `kana-qwen3-tts` and API version is `1`;
- configured model is the pinned Qwen 0.6B CustomVoice model;
- cache path is the selected external path and `model_cache_detected` becomes
  true after download;
- free disk reports at least 4 GB before installation;
- health eventually becomes `ready`;
- voices include `ono_anna` and it is the default voice.

## 3. Synthesize Japanese WAV

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Kana-Request-Id: vps-acceptance-001' \
  -d '{"text":"こんにちは。カナの音声テストです。","language":"ja","voice_id":"ono_anna","emotion":"neutral"}' \
  http://127.0.0.1:7860/v1/speech \
  --output /tmp/kana-qwen-acceptance.wav

file /tmp/kana-qwen-acceptance.wav
```

Success criteria: HTTP 200, non-empty RIFF/WAVE audio, `language` remains
Japanese, duration is audible and not zero, and the service returns request,
sample-rate, and voice headers. Listen once to confirm intelligible Japanese;
do not judge emotion on the 0.6B fixed-style voice.

## 4. Verify cancellation

Start one longer synthesis with request ID `vps-cancel-001`, then in another
terminal run:

```bash
curl -sS -X POST \
  http://127.0.0.1:7860/v1/requests/vps-cancel-001/cancel | python -m json.tool
```

Success criteria: cancellation is acknowledged; Kana does not begin stale
playback after Stop; repeating Stop remains safe. Cancellation cannot always
preempt a single low-level CPU kernel immediately, so measure browser-visible
stale playback rather than promising instant compute termination.

## 5. Record latency evidence

Keep the service running, then execute Kana's acceptance harness from the
repository on the same machine:

```bash
npm run tts:acceptance -- \
  --url http://127.0.0.1:7860 \
  --voice ono_anna \
  --warmup 1 \
  --runs 20 \
  --hardware "VPS plan, CPU model, RAM, GPU and VRAM if present" \
  --output qwen3-tts-vps-baseline.json
```

This runs short, medium, and long Japanese profiles, validates every WAV and
response header, records individual samples plus p50/p95, computes real-time
factor, and verifies active cancellation. It does not call Hermes or another
LLM. On a CPU host it can take a long time; `--request-timeout-seconds` may be
raised without changing the acceptance criteria.

Expected final output has this shape (the booleans matter; timing numbers vary
by hardware):

```json
{
  "contractPassed": true,
  "baselineComplete": true,
  "cancellationPassed": true,
  "passed": true,
  "note": "Latency is recorded evidence, not a realtime performance promise. Listen to one WAV separately for intelligibility."
}
```

Success criteria:

- the process exits with status 0 and writes the JSON evidence file;
- each profile contains 20 measured samples and non-zero audio duration;
- `contractPassed`, `baselineComplete`, `cancellationPassed`, and `passed` are
  all `true`;
- the recorded service/model/device/voice match the intended deployment;
- one WAV from step 3 has been listened to and is intelligible Japanese.

If cancellation reports `wasActive: false`, rerun with
`--cancel-delay-ms 50`; this means synthesis completed before the cancellation
probe, not that the gate should be marked as passed. Preserve the resulting
JSON with the release evidence. Only after those results may streaming be
reconsidered or experimental sentence delivery be promoted beyond opt-in.

## Decision

Streaming TTS is deferred. The current direct WAV API is deterministic,
cancellable, replayable, and tested without another Hermes request. Streaming
will be accepted only when target-hardware evidence shows a meaningful lower
time-to-first-audio without weakening cancellation or response ordering.
