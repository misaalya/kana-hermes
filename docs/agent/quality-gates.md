# Quality gates

What every Kana check proves, what each one needs from outside the checkout, and the rules that keep a pending result from being reported as a pass.

**Read when:** you are about to hand off a change, open a release, or decide whether a compatibility or field-validation claim is real.
**Truth in code:** `scripts/quality-gate.mjs`, `package.json`, `playwright.config.ts`, `playwright.pwa.config.ts`, `scripts/dogfood-check.mjs`, `scripts/hermes-active-restart-check.mjs`

## The standard gate

`npm run quality` runs the tasks listed in `scripts/quality-gate.mjs` in order and stops at the first non-zero exit status, so every step depends on the ones before it being clean.

| Order | Step | Proves |
| --- | --- | --- |
| 1 | `npm run lint` | ESLint with `eslint-config-next` accepts the source |
| 2 | `npm run typecheck` | `tsc --noEmit` reports no type error |
| 3 | `npm test` | The unit and integration suites in `tests/**/*.test.ts` pass under `node --test` through `tsx` |
| 4 | `npm run test:dogfood-harness` | `scripts/dogfood-check.mjs --self-test` — the dogfood gate computes the right verdict on fixtures |
| 5 | `npm run test:dogfood-journal` | `scripts/dogfood-journal.mjs --self-test` — the recorder validates days, matrices, and credential-shaped text |
| 6 | `npm run test:hermes:active-check` | `scripts/hermes-active-restart-check.mjs --self-test` — the restart-evidence validator computes the right verdict on fixtures |
| 7 | `npm run test:e2e` | The Playwright desktop and mobile journeys in `tests/e2e/kana-critical-journeys.spec.ts` |
| 8 | `npm run package:local` | `npm run build`, then `scripts/package-standalone.mjs` assembles `.next/standalone` |
| 9 | `npm run test:pwa:built` | The built standalone boots and passes the PWA installability and offline-shell run (`tests/e2e/pwa-installability.spec.ts`) |

Steps 4 to 6 test the validators, not the project: they never read `dogfood/journal.json` or `acceptance/hermes-active-restart.json`, and they are not field evidence. Step 8 is where the production build happens, so `npm run quality` carries no separate `npm run build` step.

Notes on the browser steps:

- `npm run test:e2e` uses `playwright.config.ts`: one worker, `tests/e2e` minus `pwa-installability.spec.ts`, and the `desktop-chrome` (1280 × 900) and `mobile-chrome` (`Pixel 5`, 390 × 844) projects. Its `webServer` starts `npm run dev` on port 3100 with a seeded password and an isolated `KANA_DATA_DIR` under `test-results/`. It runs `KANA_E2E_CHROME_PATH` or `/usr/bin/google-chrome` when present and falls back to Playwright's bundled Chromium.
- `npm run test:pwa:built` uses `playwright.pwa.config.ts`, which boots `.next/standalone/server.js` from the checkout on port 3101 with service workers allowed. It has no bundled-browser fallback, so it needs `/usr/bin/google-chrome` or `KANA_E2E_CHROME_PATH`, and it needs `npm run package:local` to have run.

## Gates that need something outside the checkout

These commands cannot run from a bare source tree and are deliberately outside `npm run quality`.

| Command | Needs | What it refuses to claim without it |
| --- | --- | --- |
| `npm run test:hermes:live` | A running `hermes serve` and its `KANA_HERMES_TOKEN`; `KANA_HERMES_WS_URL` overrides the default `ws://127.0.0.1:9127/api/ws` | That the installed Hermes answers `gateway.ready`, a live catalog, slash completion, `session.status`, and `session.close`. It creates a `source: "kana"` session with an empty message list and never sends an LLM prompt; the command and completion counts it prints are observations, not a fixed protocol |
| `npm run test:hermes:restart` | The installed Hermes binary at `~/.local/bin/hermes`, or `KANA_HERMES_BINARY` | That the bridge survives a real `hermes serve` restart and resumes the durable session. See `docs/evidence/hermes-restart.md` |
| `npm run test:live2d:official` | Network access to Live2D and the pinned official GitHub sample assets, plus a system Chrome (`/usr/bin/google-chrome` or `KANA_E2E_CHROME_PATH`; there is no bundled-browser fallback) | That both official samples render in a real WebGL context and switch with model-specific bindings across reloads |
| `npm run test:package:npm` | A built `cli/` package and an npm/Node toolchain for a global install into a temporary prefix | That the exact tarball installs, boots, sets a password, and keeps the documented data-root and cross-origin rules. It uses a fake `hermes` script on the temporary `PATH`, so it needs no real Hermes. Run it from a clone outside the home directory; inside the checkout `scripts/prepare-npm-package.mjs` only warns unless it is invoked with `--build` |
| `npm run hermes:active-check` | Hand-written, sanitized `acceptance/hermes-active-restart.json` | That Kana survives a restart during a running turn, an approval, or protected input. See `docs/evidence/hermes-restart.md` |
| `npm run dogfood:check` | A local `dogfood/journal.json` | A complete field-validation report. See `docs/evidence/dogfood.md` |
| `npm run dogfood:record`, `npm run dogfood:matrix` | A real observation to record; they write the journal | Any recorded day or matrix result. Neither the recorder nor the check invents evidence |

There is no `npm run tts:acceptance` script in `package.json`. The retired Qwen3-TTS harness is gone, so local-voice latency and intelligibility are a manual target-hardware acceptance, not an automated gate.

## Acceptance matrix

Automated checks below use mock providers unless the row names a real service or command. Every test file named exists under `tests/`.

| Journey | Automated evidence | Manual acceptance |
| --- | --- | --- |
| First run and migration | `tests/preferences/local-preferences-store.test.ts`; the onboarding journey in `tests/e2e/kana-critical-journeys.spec.ts` | A new browser profile shows the setup steps and an honest unavailable state until Hermes is connected |
| Controlled conversation | `tests/e2e/kana-critical-journeys.spec.ts` (desktop and mobile) | User message, tool activity, Japanese speech contract, and stored subtitle all appear |
| Subtitle language follows the user | The subtitle journey in `tests/e2e/kana-critical-journeys.spec.ts`; `tests/presentation/persona.test.ts` | New replies use the language the user wrote in, and stored subtitles stay byte-for-byte unchanged after reload |
| Conversation lifecycle | The draft/search journey in `tests/e2e/kana-critical-journeys.spec.ts` | Create, reopen, rename, search, delete with confirmation; each conversation keeps its own draft |
| Slash commands | The keyboard slash journeys in `tests/e2e/kana-critical-journeys.spec.ts`; `tests/agent/hermes-agent-client.test.ts`; `tests/services/resolve-command.test.ts` | Catalog, argument completion, aliases, send/skill/prefill, and honest unavailable platform commands |
| Hermes connect | `tests/agent/hermes-agent-client.test.ts`; `npm run test:hermes:live` | The real token reaches `gateway.ready`; an invalid token reports authentication failure |
| Hermes session | `tests/services/hermes-session-manager.test.ts`; `tests/agent/hermes-agent-client.test.ts`; the live audit creates and closes only a Kana test session | A linked session resumes, and a deleted session is marked missing and never silently replaced |
| Protected input | `tests/agent/hermes-agent-client.test.ts` | Approval, clarification, sudo, and secret dialogs work, and secret values never enter history or diagnostics |
| Stop and reconnect | The adapter backoff, cancellation, and recovery tests in `tests/agent/hermes-agent-client.test.ts`; isolated `npm run test:hermes:restart` for the idle case | Stop is idempotent, reconnect can be cancelled, and the active cases follow `docs/evidence/hermes-restart.md` |
| Voice | `tests/services/voice-service.test.ts`, `tests/server/tts-routing.test.ts`, `tests/server/tts-active-requests.test.ts`, `tests/server/tts-audio-safety.test.ts`, `tests/server/pollinations-tts-provider.test.ts`, `tests/server/irodori-install.test.ts`, `tests/voice/speech-chunks.test.ts`, `tests/presentation/spoken-reply-queue.test.ts`, and the voice journeys in `tests/e2e/kana-critical-journeys.spec.ts` | Offline, loading, synthesizing, playing, stopping, and failed states are accurate; replay and sentence delivery make no Hermes request |
| Avatar | `tests/avatar/` (`avatar-model-validation`, `avatar-url-security`, `binding-backup`, `fit-model`, `live2d-avatar-provider`, `moc3-version`, `official-samples`, `portrait`), the forced-fallback journey in `tests/e2e/kana-critical-journeys.spec.ts`, and `npm run test:live2d:official` | An invalid package keeps the previous avatar; Haru and Mao switch with different bindings; imported size and delete are correct |
| Backup format | `tests/backup/kana-backup.test.ts` | Stored subtitles survive the round trip, credentials and avatar assets stay out, and a malformed or unsupported envelope is refused |
| Diagnostics | `tests/diagnostics/safe-diagnostics.test.ts` | Endpoint data, error text, and the serialized state drop credentials, query values, and common secret forms; a classified failure stays in the error store in memory after its banner is dismissed |
| Responsive access | The target-width journey in `tests/e2e/kana-critical-journeys.spec.ts` (320, 360, 390, 768, 1440, and 844 × 390 landscape) | No horizontal overflow and the composer stays visible; mobile history is a modal drawer |
| Install and offline shell | `tests/e2e/pwa-installability.spec.ts` through `npm run test:pwa:built` | The manifest has no installability error, and a controlled mobile reload restores the shell without caching provider APIs |

## Rules that keep a gate honest

- A pending result never becomes a pass. `scripts/dogfood-check.mjs` and `scripts/hermes-active-restart-check.mjs` exit non-zero when evidence is missing, pending, or failing; an absent evidence file is reported with the command or document that creates it, not silently accepted.
- Never send an LLM prompt merely to prove connectivity. `scripts/hermes-live-audit.mjs` and `scripts/hermes-restart-acceptance.ts` create empty, titled, `source: "kana"` sessions and close them, and never submit a prompt.
- Use mock providers unless a row names a real service. The browser journeys route TTS to a test provider; only the rows above that name `hermes serve`, the installed Hermes binary, Live2D's assets, or a real npm install depend on an external service.
- List manual checks as manual. Restarting during a live turn or protected input, two legally permitted user Live2D packages, browser quota and WebGL context loss on target GPUs, and real local-voice latency stay manual because no automated run proves them honestly.
- Run the suite at a terminal as well as with its output piped. `node --test` sets `FORCE_COLOR` while it colorizes its report, and a caller may export it too, so an assertion that reads human-readable output can pass in a pipe and fail in front of a person when a colour escape lands inside the matched text and breaks a `\s+`. A gate that answers differently depending on where its output goes is not a gate.