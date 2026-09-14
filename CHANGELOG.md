# Changelog

## Unreleased

### Security

- **Breaking:** no default access password. Kana refuses logins until the
  owner runs `kana password` (or answers the first-run prompt of `kana` /
  `kana serve`). Installations that relied on the old built-in password must
  set one after upgrading; stored bcrypt hashes keep working and are upgraded
  to scrypt on the next login.
- Cross-site request guard: state-changing requests must come from Kana's own
  origin.
- Login lockout no longer lets anyone lock out every user: previously signed-in
  browsers keep their own bucket (device cookie); no IP-based buckets.
- Logout revokes the session token server-side.

### Changed

- Redesigned launcher output and help; new `kana password` command. A
  checkout runs `npm run package:local`, then `node bin/kana.mjs`; standalone
  deployments ship the launcher next to `server.js`.
- Hermes discovery reads `/proc` directly (no `pgrep`), recognises every
  `hermes serve` shape Hermes itself does, covers pipx/uv/Nix/Homebrew/root
  installer layouts, and re-discovers an adopted gateway whose token changed.
- `config.json` is cached per file change; an invalid file is reported in
  Settings instead of breaking the login and readiness probe.
- Request-size limits live in one module; voice references above Next's proxy
  buffer were previously truncated silently.
- Packaging copies services and assets from `git ls-files`; publishing refuses
  a dirty tree and runs lint, typecheck, and unit tests.

## 0.2.0 — 2026-09-08

### Added

- Qwen3-TTS API v2 with local voice cloning: consented reference audio becomes
  a selectable, deletable voice profile; cloned voices speak every response and
  drive Live2D lip sync like preset speakers.
- Public `kana-alya` CLI package, separated from the private source app. It
  ships the traced production runtime and provides `kana`, `kana serve`,
  `kana setup`, `kana config`, and `kana doctor`.
- A documented VPS path for the npm package as well as source-built standalone
  deployments. Both use one server-side configuration and data root.
- Settings → Hermes control panel: start/restart/stop the official
  `hermes serve` gateway, server-held credentials, live process status, and honest
  unavailability messaging when control is not enabled.
- Visual-novel theme: pastel sky stage with scene art, HUD-style header,
  purple conversation rail, named speech bubble with coral name plate, and a
  floating composer — replacing the white minimal workspace.
- Quick Hermes controls in settings for `/model` and related configuration
  commands, using the live registry rather than copied command lists.
- A provider-neutral spoken-reply queue: responses wait for playback to begin,
  then reveal their subtitle and start Live2D lip sync. Failed or stopped audio
  reveals the response as text and reports the error.

### Changed

- Production preferences always resolve to Hermes, the server-selected TTS
  provider, and Live2D with an honest placeholder when avatar loading fails.
- Live2D switching now uses a load-generation guard so a slow previous model
  can never stack on top of the newly selected one, pauses rendering when the
  stage is hidden or the tab is backgrounded, and caps renderer resolution by
  device capability.
- Real Hermes approval/clarification requests surface directly in dedicated
  dialogs as before; `/approve` and `/deny` resolve them without text parsing.
- TTS provider choice is now exclusively server-side through `tts.provider`.
  Local Qwen and OpenAI-compatible settings can coexist without colliding;
  inactive settings do not affect the active provider.
- The local Qwen runtime waits for a `ready` health state, shares model warmup,
  accepts readable request/startup timeouts, and loads every model component
  from the same pinned Hugging Face snapshot, including offline caches.
- The npm package now publishes under the stable `latest` tag. The source app
  stays private; the public package is assembled from the verified build.

### Fixed

- Stacked double-avatar bug when switching Live2D models quickly.
- `.env.example` no longer enables development mocks by default.
- TTS no longer fails on HTTP origins where `crypto.randomUUID` is unavailable.
- Stop remains available while TTS is synthesizing or playing, cancellation is
  routed to the provider that began the request, and stale audio cannot stop a
  newer reply.
- Password changes revoke prior sessions; login admission, JWT claims, request
  bodies, SSE cleanup, and activity numeric fields are now bounded and
  validated at the server boundary.
- The built-in voice reference survives package-location changes and Qwen
  reports dependency/model-load errors instead of remaining indefinitely in a
  starting state.

### Release notes

- Hermes tokens remain server-side; legacy browser credential fields are
  discarded. Hermes owns the transcript and Kana stores per-turn activity in
  SQLite under the common data root.
- This is the first non-prerelease Kana release. The supported package target
  remains Linux x64 with glibc and Node.js 22.13 or later.
- Current supported behavior, deployment paths, provider configuration, and
  remaining environment limits are recorded in the README and `docs/`.

## Pre-0.2 development history

### Added

- Unmodified Hermes `serve` adapter with durable sessions, live slash catalog,
  protected input, reconnect/backoff, duplicate-terminal protection, and live
  compatibility audit.
- Japanese Kana response envelope with user-selected, historically preserved
  subtitles.
- IndexedDB conversations, search, rename/delete, per-conversation drafts,
  linked/missing/branch markers, and legacy localStorage migration.
- Qwen3-TTS API v1 service/client, lifecycle, cancellation, replay, Web Audio
  playback, amplitude lip sync, target-host p50/p95 acceptance harness, and an
  opt-in ordered sentence-delivery experiment.
- Replaceable Live2D runtime, official Haru/Mao samples with distinct mouth
  bindings, safe renderer reuse during switching, validated folder import,
  hosted/folder model library, previews, and binding files.
- First-run setup, responsive white workspace, safe diagnostics, CSP/security
  headers, local backup/restore, error boundaries, and modal focus management.
- Repeatable quality gate, 42 unit/integration tests, 16 desktop/mobile browser
  journeys, production PWA install/offline audit, isolated real-Hermes
  refresh/restart audit, standalone package assembly, and executable
  dogfood/target-host acceptance gates.
- Validated dogfood journal commands, a structured five-case active Hermes
  restart evidence checker, and one consolidated field-validation handoff.

### Migration notes

- Preference schemas v1–v4 migrate to v5. Hermes tokens move to tab-scoped
  session storage; tokens embedded in legacy WebSocket URLs are stripped and
  moved as well. Existing voice setups retain complete-response delivery.
- Legacy `kana.conversations.v1` history imports idempotently into IndexedDB;
  stored subtitle text/language remains unchanged.
- Backup format `kana.local-backup` v1 excludes Hermes credentials and imported
  Live2D assets. Live2D binding files use a separate version-1 envelope.

### Known limitations

See [supported environment](docs/SUPPORTED_ENVIRONMENT.md) and the open items in
[PLAN.md](PLAN.md) for known environment limits and future work.
