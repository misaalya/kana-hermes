# Qwen3-TTS VPS acceptance

Use this on the target VPS or workstation. The current development machine was
not used for heavy inference because its available GPU memory and local disk
are below the practical target. Passing browser contract tests does not count
as passing real synthesis.

## 1. Prepare isolated storage

The service is a zero-dependency Node adapter (`services/qwen3-tts/server.mjs`)
driving a pure-C inference engine — no Python, no PyTorch. One-time engine and
model provisioning:

```bash
npm run tts:setup
```

This clones the pinned MIT-licensed engine (gabriele-mastrapasqua/qwen3-tts),
builds it with OpenBLAS, and prepares the official ~2.3 GB
`qwen3-tts-0.6b-base` model under `~/.cache/kana/qwen3-tts-engine` by default.
Point it at external storage with `KANA_TTS_ENGINE_DIR`, `KANA_TTS_MODEL_DIR`,
and `KANA_TTS_DATA_DIR`; tune builds with `KANA_TTS_ENGINE_JOBS`,
`KANA_TTS_ENGINE_QUANT`, and runtime limits with `KANA_TTS_MAX_SYNTH_SECONDS`
(see `services/qwen3-tts/README.md`). Then start the service:

```bash
npm run tts:dev        # node services/qwen3-tts/server.mjs
# host/port override: KANA_TTS_HOST / KANA_TTS_PORT
```

Expected startup: the HTTP server listens on `127.0.0.1:7860`; health can
report `loading` until the engine and model are ready.

## 2. Check setup without inference

```bash
curl -s http://127.0.0.1:7860/v1/setup | python -m json.tool
curl -s http://127.0.0.1:7860/v1/health | python -m json.tool
curl -s http://127.0.0.1:7860/v1/voices | python -m json.tool
```

Success criteria:

- service is `kana-qwen3-tts` and `api_version` is `"2"` (the browser contract
  rejects any other version);
- configured model is the pinned Qwen 0.6B **Base** model
  (`qwen3-tts-0.6b-base`);
- cache path points at the prepared engine directory and
  `model_cache_detected` is true after provisioning;
- free disk reports at least 4 GB before installation;
- health eventually becomes `ready`;
- voices include the built-in profile `builtin-kana` ("Kana", auto-cloned from
  `assets/kana.wav` on first use); `default_voice_id` is the most recently
  created profile.

## 3. Synthesize Japanese WAV

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Kana-Request-Id: vps-acceptance-001' \
  -d '{"text":"こんにちは。カナの音声テストです。","language":"ja"}' \
  http://127.0.0.1:7860/v1/speech \
  --output /tmp/kana-qwen-acceptance.wav

file /tmp/kana-qwen-acceptance.wav
```

Success criteria: HTTP 200, non-empty RIFF/WAVE audio, `language` remains
Japanese, duration is audible and not zero, and the service returns request,
sample-rate, and voice headers. Listen once to confirm intelligible Japanese;
do not judge emotion on the 0.6B fixed-style voice (`supports_instruction` is
false — the service accepts no usable `emotion` field).

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

## 4b. Zombie grandchild check (owner, live hardware)

The Node adapter spawns the pure-C `qwen_tts` engine CLI once per speech
request and kills that child directly; verify stop really ends everything. On
the target host:

1. Start the service from Kana (Settings control panel or `POST
   /api/voice/tts/control {"action":"start"}`).
2. Run one synthesis, then stop the service the same way and immediately run
   `ss -ltnp | grep 7860`.
3. Pass: nothing listens on 7860 and no `qwen_tts`/`kana-qwen3-tts` process
   remains (`pgrep -af qwen_tts`).
4. If an engine child survives a Stop during active synthesis, record it as a
   failure — cancellation must kill the in-flight child process, not wait for
   kernel completion — then fix the spawn guard and repeat steps 1–3.

Record the outcome in the release evidence alongside the latency JSON.

## Decision

Streaming TTS is deferred. The current direct WAV API is deterministic,
cancellable, replayable, and tested without another Hermes request. Streaming
will be accepted only when target-hardware evidence shows a meaningful lower
time-to-first-audio without weakening cancellation or response ordering.
