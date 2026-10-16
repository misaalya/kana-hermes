# State and storage

Kana keeps browser state that is a convenience only, and server state that is
the installation's shared truth. Nothing else persists, and no new storage
location may be added: every server file resolves under one data root, and the
browser never holds a Hermes token.

**Read when:** you are adding state, a cache, a preference, a persisted file,
or a route that reads or writes one.
**Truth in code:** `lib/services/kana-workspace.ts`, `lib/store/kana-stores.ts`,
`lib/preferences/local-preferences-store.ts`, `lib/server/data-dir.ts`,
`lib/server/app-state-store.ts`, `lib/server/activity-store.ts`,
`lib/limits.ts`

## Shared workspace state

Shared state lives in the zustand vanilla stores under `lib/store/`, built per
mount by `createKanaStores()` and wired to services by
`createKanaWorkspace()` in `lib/services/kana-workspace.ts`. There is one set
per mounted workspace, so two tabs or a remount never share conversation,
session, or activity state. Never create a module-level store or module-level
cache. State that only one component reads and writes stays local `useState`.

`lib/services/` owns side effects; components call the stable `actions` object
the workspace exposes rather than mutating a store directly. The stores are
`preferences`, `conversations`, `agentSession`, `activity`, `commands`,
`errors`, `models`, `voice`, `avatar`, and `workspace`. The theme is the
exception that proves the rule: `lib/state/use-theme.ts` creates its store per
component mount because nothing else depends on it.

## Browser state

The browser keeps presentation choices and local convenience records only. It
never stores a Hermes endpoint, session token, or credential in any form.

| Location | Holds |
| --- | --- |
| `localStorage` `kana.preferences.v5` | Presentation preferences. `load()` reads the legacy keys `kana.preferences.v4..v1` when v5 is absent, normalizes, and rewrites v5. Credentials are dropped on persist. |
| `localStorage` `kana.active-conversation.v1` | The selected conversation pointer (id, title, createdAt, optional durable Hermes session id), so a refresh returns to the same Hermes session. |
| `localStorage` `kana.avatar.portraits.v1` | The 16 newest stage portraits (192 px WebP) cut from the canvas; never uploaded or shipped. |
| `localStorage` `kana.pending-input.v1` | Request metadata for an approval/clarification/sudo/secret dialog that Hermes does not replay. Answers, passwords, and secret values never pass through here. |
| `sessionStorage` `kana.repairPrompt.seen` | Per-tab flag that the degraded-connection repair prompt was already offered. |
| IndexedDB `kana.local` v2 | Imported Live2D model packages (`avatarModels`) and uploaded stage background images (`stageBackgrounds`), validated before write. |

`normalizeKanaPreferences` forces `agentMode: "hermes"`, `voiceMode: "configured"`,
and `avatarMode: "live2d"` on every load and save, drops the retired
subtitle-language setting, and retires the old Qwen3-TTS voice fields. An
unreadable stored record is left in place for recovery (the store reports a
warning) rather than overwritten with defaults.

The IndexedDB database also declares a `conversations` object store, but no
code reads or writes it. Conversation history is not stored in the browser:
Hermes owns the transcript and Kana restores it from `session.resume`, keeping
only the working set in the conversation store plus the pointer above. Do not
treat either as a second copy of history.

## Server state

One data root holds every server file. `lib/server/data-dir.ts` resolves it in
this order: `KANA_DATA_DIR` (must be absolute) -> `$HOME/.kana`. An explicit but
invalid root, or any failure in production, throws; only an unset root in
development falls back to `$CWD/data`. Roots earlier releases wrote into
(`$XDG_DATA_HOME/kana`, `$HOME/.local/share/kana`, `$CWD/data`) are moved into
the resolved root on the first start, without overwriting, one file at a time,
and only when Kana resolved its own default root: an operator-set
`KANA_DATA_DIR` is used as-is. `adoptLegacyKanaFile` remains the per-file
fallback for `appstate.db`, `activities.db`, `jwt-secret`, and `auth.json` (a
bcrypt `auth.json` hash is verified and upgraded in place).

| Path under the data root | Holds |
| --- | --- |
| `appstate.db` | `app_state` rows (`auth.password` hash + session version, `onboarding` completion), the `voice_clones` voice library, and the `revoked_sessions` logout list. Owner-only, WAL. |
| `activities.db` | The per-turn tool activity log, schema v2. |
| `jwt-secret` | The installation secret that signs session and login-device JWTs and derives other keys. `KANA_JWT_SECRET` overrides it (minimum 32 characters). |
| `config.json` | The server-owned advanced config (deployment mode, Hermes executable/port/working folder, TTS provider and credentials). Created from `config/default-config.json`; never returned to the browser. |
| `voices/` | Reference WAVs for the voice library; `appstate.db` holds only their metadata and paths. Engine/model installs and downloads live under `irodori/` (unless `tts.irodoriLocal.installDirectory` overrides it). |

`appstate.db` is created and read through `lib/server/app-state-store.ts` so
the `kana` launcher and the server share one schema and handle. Do not open it
directly from a new module; do not introduce a second database file.

`activities.db` (`lib/server/activity-store.ts`, schema v2) is keyed by the
Hermes durable session key plus a zero-based assistant-reply ordinal
(`turn_index`), with the anchor timestamp as the primary-key fallback for
legacy v1 rows. One live write and one reconstructed write for the same turn
converge on a single row, which is what lets the feed splice a turn's tools
back in after a refresh or in another browser.

Process-held state is deliberately not persisted: the Hermes session token and
the shared gateway socket (`lib/server/hermes-bridge.ts`), the managed runtime
(`lib/server/local-hermes-runtime.ts`), the login lockout buckets
(`lib/server/auth/login-limiter.ts`), and TTS cancellation tracking. Logout
revocation is the exception and is stored in `appstate.db` so a copied token
stays revoked across a restart.

## Media links

`lib/server/media-links.ts` rewrites every deliverable `MEDIA:/local/path` in
Hermes replies, tool output, and restored history to
`MEDIA:/api/media/<token>/<name>` before the payload reaches the browser. The
token is the resolved path encrypted and authenticated with AES-256-GCM under
a key derived from the installation secret, with a synthetic IV so the same
file always produces the same link. There is no table to maintain or expire,
and the browser cannot name a path.

Deliverability is checked when the link is minted and again on every request:
the path must resolve to an existing regular file outside system paths, home
credential folders and files, Hermes's secret files, and Kana's own data root.
`lib/server/media-response.ts` streams the file with `Range`, `If-Range`, and
`ETag` support, and a sandbox CSP so a delivered SVG or HTML never runs as
Kana. Hermes's own `GET /api/media` is unused.

## Backup

`lib/backup/kana-backup.ts` defines version 1 of the local backup, whose
envelope carries `kind: "kana.local-backup"`, the sanitized preferences, and
the conversations. Export strips credentials, the custom stage background,
imported-model bindings, and avatar assets; import parses and bounds every
record (50 MB file, 10,000 conversations, per-field length limits) and merges
matching ids without deleting unmatched local history. Imported Live2D files
are not included and must be moved separately under their own license.

## Request limits

Request-size limits live only in `lib/limits.ts`. Route handlers read bounded
bodies through `lib/server/request-body.ts`, which counts wire bytes and
rejects oversized input before decoding. Next's proxy buffer
(`proxyClientMaxBodySize` in `next.config.ts`) and the documented Nginx
`client_max_body_size` are both derived from `MAX_REQUEST_BODY_BYTES`, because
Next silently truncates a longer body instead of failing. Change a limit
there, never in a route.