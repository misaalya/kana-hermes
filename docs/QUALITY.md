# Kana quality and user-journey matrix

This is the repeatable acceptance matrix for Kana. Automated checks use test
doubles at service boundaries unless a row explicitly names a real local
service; tests must never send an LLM prompt merely to verify connectivity.
The product has no mock agent, voice, or conversation providers — modes are
fixed to Hermes, Qwen3-TTS, and Live2D, and unavailable integrations degrade
to honest placeholder states.

| Journey | Automated evidence | Manual acceptance |
| --- | --- | --- |
| First run | Preference migration tests | New browser profile shows four setup steps; offline defaults land on honest placeholder states |
| Mock conversation | Playwright desktop/mobile | User message, tool activity, Japanese speech contract, and stored subtitle appear |
| Subtitle change | Playwright desktop/mobile | Existing subtitle stays byte-for-byte unchanged after change and reload |
| Conversation lifecycle | Playwright draft/search test | Create, reopen, rename, search, delete with confirmation; draft remains per conversation |
| Slash commands | Playwright keyboard test; Hermes adapter tests | `/` catalog, argument completion, aliases, send/skill/prefill, and unavailable platform commands are honest |
| Hermes connect | Adapter tests; `npm run test:hermes:live` | Correct token reaches `gateway.ready`; invalid token says authentication failed |
| Hermes session | Adapter recovery tests; live audit creates/closes only a Kana test session | Linked session resumes; deleted session is marked missing and never silently replaced |
| Protected input | Hermes adapter tests | Approval, clarification, sudo, and secret dialogs work; secret values never enter history or diagnostics |
| Stop/reconnect | Adapter backoff/cancellation/recovery tests; isolated `npm run test:hermes:restart` idle restart | Stop is idempotent; reconnect can be cancelled; active/protected-input matrix follows the restart acceptance document |
| Voice | Qwen browser-contract, chunk-order, and benchmark-harness tests | Offline/loading/synthesizing/playing/stopping/failed states are accurate; replay and sentence delivery do not call Hermes |
| Avatar | Package/URL unit tests; forced-fallback Playwright; `npm run test:live2d:official` | Invalid package preserves previous avatar; Haru/Mao switch with different bindings; imported size/delete are correct |
| Backup/restore | Backup unit test; Playwright export/restore | JSON excludes token/avatar files, restore merges without deleting unmatched history or changing stored subtitles |
| Diagnostics | Redaction unit tests; Playwright preview test | No token, prompt, tool output, sudo value, secret value, or subtitle appears |
| Responsive access | Playwright at 320/360/390/768/1440 plus mobile landscape | No horizontal overflow; composer remains visible; mobile history is a modal drawer |
| Install/offline shell | Production persistent-profile PWA test | Manifest has no installability errors; controlled mobile reload restores the shell offline without caching provider APIs |

## Standard gates

Run before handoff:

```bash
npm run quality
```

This executes lint, TypeScript, unit/integration tests, Playwright desktop and
mobile journeys, production build, local standalone package assembly, and a
production-profile PWA installability/offline-shell audit.
The Qwen3-TTS adapter's Node contract smoke tests are opt-in inside the gate:

```bash
KANA_RUN_TTS_SERVICE_TESTS=1 npm run quality
```

The real Hermes compatibility audit is separate because it requires a
temporary running `hermes serve` and token:

```bash
KANA_HERMES_WS_URL=ws://127.0.0.1:9127/api/ws \
KANA_HERMES_TOKEN=replace-with-test-token \
npm run test:hermes:live
```

Expected properties: `gatewayReady: true`, a non-zero live catalog and
completion count, `sessionStatusAvailable: true`, and `sessionClosed: true`.
The exact number of commands is deliberately not fixed.

An idle process-restart audit needs no model or user data and runs against an
isolated temporary Hermes home:

```bash
npm run test:hermes:restart
```

See `docs/HERMES_RESTART_ACCEPTANCE.md` for the expected JSON and interactive
thinking/approval/secret/answer-boundary matrix.

The real WebGL/sample-switch acceptance is network-dependent and therefore
separate from the deterministic quality gate:

```bash
npm run test:live2d:official
```

On target Qwen hardware, run `npm run tts:acceptance` and preserve its JSON
report. During the beta period, `npm run dogfood:check` reports the remaining
seven-day, environment-matrix, and P0/P1 gates.

Record real daily evidence with `npm run dogfood:record`, update completed
matrix rows with `npm run dogfood:matrix`, and validate the five active Hermes
restart cases with `npm run hermes:active-check`. The consolidated remaining
procedure is in `docs/BETA_ACCEPTANCE_HANDOFF.md`.

## Manual checks not honestly automatable here

- Restart Hermes while working and waiting for each protected input; idle
  restart is now automated with the real installed binary.
- Use two user-supplied, legally permitted Live2D packages with different
  parameter bindings. Haru/Mao already prove the official-sample runtime path,
  but do not replace this user-package dogfood case.
- Verify browser storage quota and WebGL context-loss behavior on target GPUs.
- Run real Qwen inference and latency sampling on target hardware using the
  VPS acceptance procedure.
- Dogfood for at least one week before calling a build beta-ready.
