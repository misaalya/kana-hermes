# ADR-002: Use complete WAV responses before streaming TTS

Status: accepted baseline; opt-in sentence experiment implemented; streaming
deferred, 2026-08-22.

Kana's Qwen provider uses one cancellable HTTP synthesis request and direct WAV
playback. The generated audio can be replayed in memory without another Hermes
or Qwen request. Conversation changes and Stop invalidate stale responses.

Complete-response WAV remains the default because it has the simplest failure
model and smoothest prosody. Kana also offers an explicitly experimental
sentence-chunk mode. It deterministically splits the same `speech_ja`, preserves
the exact text and order, prefetches the next Qwen request while the current
part plays, cancels the active part on Stop, and caches all parts for replay.
It does not call Hermes again or introduce a translation/agent model.

The experiment records time-to-first-audio and per-turn synthesis/playback
metrics, but it is not promoted to the default without target-hardware
evidence. The development machine is not suitable for meaningful heavy
inference. `npm run tts:acceptance` collects short/medium/long p50/p95 and
real-time-factor evidence plus active cancellation on the VPS.

Streaming remains unadopted. It may proceed only if a bounded target-hardware
spike shows a meaningful improvement over both complete WAV and sentence
chunks while retaining deterministic ordering, idempotent Stop, replay, and
one Hermes response.

Historical note: the bounded source spike below ran against the retired
Python/FastAPI service v1, which is no longer the pinned stack — the current
service is the zero-dependency Node adapter over the pure-C engine. The
finding still stands: that stack also had no honest stream. The v1 spike found
no honest stream in its stack: service v1 waits for `generate_custom_voice` to
return a complete waveform, writes the whole waveform to an in-memory WAV, and
returns a normal FastAPI `Response`. Replacing that with a streaming HTTP
wrapper would still buffer until model generation finished and would not
improve time-to-first-audio. A future stream therefore requires a reviewed
incremental model/runtime API and a versioned service contract, not just a
frontend change.
