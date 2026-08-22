# Changelog

## 0.2.0-alpha.1 — unreleased

### Added

- Qwen3-TTS API v2 with local voice cloning: consented reference audio becomes
  a selectable, deletable voice profile; cloned voices speak every response and
  drive Live2D lip sync like preset speakers.
- Global npm launcher (`kana`, `kana setup`, `kana doctor`) that runs the web
  app from user directories, supervises the optional Qwen3-TTS service, keeps
  the multi-gigabyte model out of the package, and gates local Hermes process
  control behind `KANA_LOCAL_RUNTIME_CONTROL`.
- Settings → Hermes control panel: start/restart/stop the official
  `hermes serve` gateway, token entry, live process status, and honest
  unavailability messaging when control is not enabled.
- Visual-novel theme: pastel sky stage with scene art, HUD-style header,
  purple conversation rail, named speech bubble with coral name plate, and a
  floating composer — replacing the white minimal workspace.
- Quick Hermes controls in settings for `/model` and related configuration
  commands, using the live registry rather than copied command lists.

### Changed

- Mock providers are compiled out of production builds via
  `NEXT_PUBLIC_KANA_DEVELOPMENT_MODE`; production preferences always resolve to
  the real agent/voice/avatar modes.
- Live2D switching now uses a load-generation guard so a slow previous model
  can never stack on top of the newly selected one, pauses rendering when the
  stage is hidden or the tab is backgrounded, and caps renderer resolution by
  device capability.
- Real Hermes approval/clarification requests surface directly in dedicated
  dialogs as before; `/approve` and `/deny` resolve them without text parsing.

### Fixed

- Stacked double-avatar bug when switching Live2D models quickly.
- `.env.example` no longer enables development mocks by default.

## 0.1.0-alpha — unreleased

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
  restart evidence checker, and one consolidated beta acceptance handoff.

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
[PLAN.md](PLAN.md). This build is not beta until the dogfood and target-host
acceptance gates are complete.
