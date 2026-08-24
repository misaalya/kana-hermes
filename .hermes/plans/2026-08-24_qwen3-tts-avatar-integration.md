# Qwen3-TTS Service Abstraction + Auto-Start Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the local Qwen3-TTS Python service behave like `hermes serve` does in
Kana today: discovered if already running, auto-spawned when absent, and always
reached by the browser through a server-side relay (never directly), with lipsync
and emotion wiring to the Live2D avatar verified end-to-end.

**Architecture:** Mirror the proven `local-hermes-runtime.ts` → `hermes-bridge.ts`
→ `app/api/local-runtime/hermes` + `/api/hermes/*` pattern for TTS:
`lib/server/local-qwen3-tts-runtime.ts` (discover/spawn/probe) → new relay routes
under `app/api/voice/tts/*` → browser contract functions rewritten to call the
relay instead of `prefs.qwen3Tts.baseUrl`. `ensureQwen3TTSService()` inside the
relay gives the same "just works" behavior as `ensureHermesConnection()`.

**Tech Stack:** Next.js node runtime, child_process spawn of `uv run --project
services/qwen3-tts kana-qwen3-tts`, existing FastAPI service (127.0.0.1:7860),
existing WebAudio lipsync (no changes needed there).

---

## Current context (verified 2026-08-24)

- TTS service exists and works: `services/qwen3-tts` (FastAPI, port 7860,
  `/v1/health|setup|voices|speech`). Must be started manually via uv today.
- Browser calls it **directly**: `lib/voice/qwen3-tts-contract.ts` fetches
  `prefs.qwen3Tts.baseUrl`. This breaks on the real deployment — Kana runs on
  the VPS behind nginx, but `127.0.0.1:7860` only resolves on the server host.
  A phone browser can never reach it. Same reason the Hermes token lives
  server-side.
- Proven automation precedent: `lib/server/local-hermes-runtime.ts`
  (`inspectLocalHermesRuntime`, `startLocalHermesRuntime`, probe, process scan)
  + `ensureHermesConnection()` auto-discovery in `hermes-bridge.ts` +
  loopback+session-guarded control route `app/api/local-runtime/hermes/route.ts`.
- Avatar link already works client-side once audio arrives:
  `AudioLipSyncController` (RMS → `avatar.setMouthOpen`) and
  `avatarController.presentEmotion()` on assistant message. No changes needed;
  they just need audio to actually flow.
- Preferences already carry `qwen3Tts.baseUrl/voiceId/deliveryMode`.

## Design decisions

1. **Server-side ownership.** The TTS process is managed by Kana's Node server
   exactly like `hermes serve`. The browser never sees the TTS base URL as a
   functional requirement (it stays in prefs only as an override display value).
2. **Relay, not proxy-by-config.** New routes under `/api/voice/tts/*` forward
   to `127.0.0.1:${port}` server-side. Contract functions switch to relative
   URLs. This fixes mobile access AND removes CORS dependence.
3. **Ensure-on-use.** Every relay request calls `ensureQwen3TTSService()`
   (probe → adopt external instance if found → spawn managed child otherwise).
   First use after model-cold-start may take minutes (2.3 GB download first
   ever run); relay returns structured "loading" status the UI can show, and
   synthesis waits bounded (configurable timeout, default generous).
4. **Fail honestly** per AGENTS.md: if spawn fails or health never passes,
   relay surfaces `{ state, message }` — no fake audio.
5. **Security parity:** relay routes sit under the existing auth proxy prefix
   discipline (session-valid check like other /api routes); no new ports
   exposed; service keeps binding 127.0.0.1.

---

## Step-by-step plan

### Task 1: Server runtime module (discovery + spawn)

**Files:**
- Create: `lib/server/local-qwen3-tts-runtime.ts`
- Test: `tests/local-runtime/local-qwen3-tts-runtime.test.ts`

Mirror `local-hermes-runtime.ts` structure:

- Types: `LocalQwen3TtsRuntimeStatus { state: stopped|starting|running|failed|external; port; pid?; managed: boolean; model?; device?; message }`
- `probe(port)`: GET `/v1/health` with 750 ms timeout.
- `inspectQwen3TtsRuntime(preferredPort?)`: managed-child check → probe default
  port 7860 → return stopped. (No process-table scan needed initially: the
  service has no session token to steal, a port probe is sufficient proof.
  Keep it simple — YAGNI.)
- `startQwen3TtsRuntime({ port })`: resolve `uv` (env `KANA_TTS_UV_BIN`
  override, else PATH), spawn detached-from-event-loop child:
  `uv run --project <repo>/services/qwen3-tts kana-qwen3-tts` with env passthrough
  `KANA_TTS_PORT`, `KANA_TTS_HOST=127.0.0.1`, optional `KANA_TTS_CACHE_DIR` /
  `KANA_TTS_DEVICE` read from server env. Capture stderr ring buffer for error
  messages. `waitUntilReady` deadline: 120 s warm, plus detect "first-run
  download" (log heuristics) and extend to 15 min max.
- `stopQwen3TtsRuntime()`: SIGTERM managed child, wait, SIGKILL fallback.
- Module-singleton state identical in shape to `ManagedRuntime`.

**Steps:** failing test with a fake HTTP port probe (inject fetch or use an
ephemeral http server in test) → implement → tests pass → commit
`feat: qwen3-tts local runtime discovery and spawn`.

### Task 2: Ensure-on-use helper

**Files:**
- Modify: `lib/server/local-qwen3-tts-runtime.ts` (add export)
- Test: extend Task 1 test file

Add `ensureQwen3TTSService(): Promise<{ ok: true; port: number } | { ok: false; status: LocalQwen3TtsRuntimeStatus }>`:
- If managed child alive and probe passes → ok.
- If external instance on 7860 responds → adopt (mark external, remember pid via
  `/proc` best-effort) → ok.
- Else if executable chain resolvable (`uv` present + project dir exists) →
  start + waitUntilReady → ok.
- Else → not-ok with honest message ("uv not found", "model cache missing",
  etc.). Guard against concurrent starts with an in-flight promise (same trick
  as `connectPromise`).

Commit: `feat: ensureQwen3TTSService ensure-on-use`.

### Task 3: Relay API routes

**Files:**
- Create: `app/api/voice/tts/status/route.ts` — GET → inspect + ensure (non-blocking variant: report `starting` without waiting).
- Create: `app/api/voice/tts/control/route.ts` — POST `{action: start|stop|restart}` mirroring `app/api/local-runtime/hermes/route.ts` auth posture (loopback + session checks copied verbatim).
- Create: `app/api/voice/tts/speech/route.ts` — POST: `ensureQwen3TTSService()` → forward body JSON to `http://127.0.0.1:port/v1/speech`, stream binary audio response back with `Content-Type` passthrough. On ensure-failure return 503 `{error, detail}`. Long timeout (no 30 s cap; use AbortSignal.timeout(configurable, default 300 s)).
- Create: `app/api/voice/tts/voices/route.ts` — GET forward `/v1/voices`; also forward clone POST `/v1/voices/clone` and DELETE here (method-based dispatch) so voice cloning works remotely too.

All routes: `export const runtime = "nodejs"; dynamic = "force-dynamic";`

**Tests:** `tests/api/voice-tts-routes.test.ts` — mock the runtime module
(`vi.mock`) and assert forwarding paths, auth rejections, 503 shape.

Commit: `feat: server-side tts relay routes`.

### Task 4: Rewire browser contract to relay

**Files:**
- Modify: `lib/voice/qwen3-tts-contract.ts` — all `qwen3TTSUrl(baseUrl, …)`
  call sites become relative `/api/voice/tts/…` endpoints. Keep function names.
  `inspectQwen3TTSService()` now consumes the relay status shape (map to
  existing `VoiceProviderStatus`).
- Modify: `lib/voice/qwen3-tts-provider.ts` — speak path posts to
  `/api/voice/tts/speech`; handle 503 by throwing a typed
  `VoiceUnavailableError(message)` so the controller reports it honestly.
- Modify: `lib/state/use-voice-controller.ts` — `getVoice()` key drops
  `prefs.qwen3Tts.baseUrl` (server owns location now); keep voiceId/deliveryMode.
- Modify: `lib/preferences/types.ts` + defaults + settings UI — deprecate
  `qwen3Tts.baseUrl` to informational-only (or remove if UI references are few;
  prefer removal + migration note in CHANGELOG).
- Tests: update `tests/voice/qwen3-tts-provider.test.ts`,
  `tests/voice/qwen3-tts-provider.test.ts` fixtures from absolute to relative URLs.

**Verify:** unit suite green. Commit: `refactor: browser talks to tts via relay`.

### Task 5: Status surface + auto-start UX

**Files:**
- Modify: `components/...` wherever voice status renders (find via grep
  `voiceStatus` / `inspectVoiceService` usage).
- Behavior: on mount (when `voiceEnabled`), GET `/api/voice/tts/status`. States
  map to existing lifecycle chips: `starting` shows "Loading Qwen3-TTS model…"
  (with note about first-run multi-minute download), `external`/`running` ready,
  failure shows actionable message. A manual Start/Restart button calls the
  control route — same UX as Hermes runtime card if one exists in settings.
- No polling loops unless `starting` (poll every 5 s while starting, stop on terminal state).

Commit: `feat: tts status surface with autostart feedback`.

### Task 6: End-to-end integration verification (real path)

Per debugging discipline — no "done" claims without executing:

1. Stop any running TTS service. Open Kana, send a prompt with voiceEnabled.
2. Confirm server log shows spawn; relay blocks until health; audio plays;
   Live2D mouth moves (AudioLipSync active); emotion applied at message time.
3. Restart scenario: kill service externally → next speak triggers ensure → recovers.
4. Mobile check through nginx: phone browser produces voice + lipsync (this was
   impossible before the relay).
5. Run full suites: `npm test` (unit) and relevant Playwright specs
   (`playwright.live2d.config.ts`).
6. Commit any fixes; final commit `chore: e2e verified tts-autostart`.

## Files likely to change (summary)

```
Create: lib/server/local-qwen3-tts-runtime.ts
Create: app/api/voice/tts/{status,control,speech,voices}/route.ts
Modify: lib/voice/qwen3-tts-contract.ts
Modify: lib/voice/qwen3-tts-provider.ts
Modify: lib/state/use-voice-controller.ts
Modify: lib/preferences/types.ts (+ defaults + settings UI)
Test:   tests/local-runtime/, tests/api/, tests/voice/
Docs:   AGENTS.md (service section), services/qwen3-tts/README.md
```

## Risks / tradeoffs / open questions

- **Cold start latency:** first-ever run downloads ~2.3 GB; even warm CPU load
  takes tens of seconds. Mitigation: status UX + long relay timeouts; optional
  follow-up: keep-alive so the model stays resident.
- **CPU inference speed** on the VPS may make sentence_chunks mode mandatory
  for acceptable TTF-audio. Delivery-mode preference already exists.
- **uv availability on server:** must be installed for the user running
  Next.js; runtime errors name this explicitly.
- **Disk guard:** reuse the `/v1/setup` disk-sufficient signal before spawning
  to fail fast with a clear message.
- **baseUrl pref removal** touches stored preferences — need a tolerant loader
  (unknown keys ignored) which the preferences store already appears to have;
  verify in Task 4.
- Open question for user: should the TTS child be supervised/restarted forever
  (like PM2 semantics) or single-restart-per-page-lifetime like the Hermes
  managed runtime? Plan assumes Hermes-parity (single managed child, manual
  restart via control route).
