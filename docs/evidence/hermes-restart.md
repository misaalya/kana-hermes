# Hermes restart evidence

How Kana proves it survives a real `hermes serve` restart: an isolated automated harness for the idle case, and a hand-written matrix for restarts during a running turn or protected input.

**Read when:** you run the restart gate, record a restart acceptance case, or explain why a restart claim is not proven yet.
**Truth in code:** `scripts/hermes-restart-acceptance.ts`, `scripts/hermes-active-restart-check.mjs`, `lib/server/local-hermes-runtime.ts`

## Isolated automated harness

```bash
npm run test:hermes:restart
```

`scripts/hermes-restart-acceptance.ts` runs against the installed, unmodified Hermes binary at `~/.local/bin/hermes` (or `KANA_HERMES_BINARY`) and needs nothing else. It never reads or writes the user's normal Hermes database, and it sends no LLM prompt.

The harness:

1. Creates a temporary `HERMES_HOME` under the OS temp directory and allocates one free port.
2. Generates a random session token, installs it into the server bridge through `__setTestToken`, and asserts `managedRuntimeToken()` returns it, so the token stays server-side.
3. Spawns `hermes serve --host 127.0.0.1 --port <port>` with `HERMES_HOME` set to the temporary home and `HERMES_DASHBOARD_SESSION_TOKEN` set to the token, and waits for the port.
4. Connects the shared bridge and calls `session.create` with `source: "kana"` and `close_on_disconnect: false`, then `session.title`, so Hermes stores a durable session without an LLM prompt. The durable id is `stored_session_id` when Hermes returns one, otherwise the runtime id.
5. Stops that server (SIGTERM, then SIGKILL after 10 seconds), starts a second server on the same port with the same temporary home, and reconnects the bridge.
6. Resumes the durable id through `session.resume` and compares the returned id, then checks that at least one bridge event arrived after the restart.
7. Removes only the temporary home in its `finally` block.

Expected output:

```json
{
  "isolatedHermesHome": true,
  "userHermesDataTouched": false,
  "tokenHeldServerSideOnly": true,
  "initialSessionCreated": true,
  "resumedAfterRestart": true,
  "eventsObserved": true,
  "temporaryHomeRemovedOnExit": true
}
```

The command exits 0 when the session was created and resumed; it sets exit code 2 when either is false and exit code 1 on an error, printing recent `hermes serve` output. Repeated `error` and `reconnecting` frames while the server is down are expected; the durable id must survive.

The harness does not run `/status`, and it does not reconstruct a Kana browser adapter. This document describes what the script does; where the two disagree, the script is the truth.

## Active-restart matrix

Restarts during a live turn, an approval, or protected input need deliberate timing and may consume model tokens, so they are not automated. Use a disposable Kana conversation, a harmless command such as reading the current directory for approvals, and a temporary test credential for protected input. Do not weaken global approval policy to make a case easier.

`acceptance/` is ignored in `.gitignore`, so `acceptance/hermes-active-restart.json` is hand-written local evidence. Create it when your checkout has none and keep it out of the repository. Enter the sanitized result there and run:

```bash
npm run hermes:active-check
```

`scripts/hermes-active-restart-check.mjs` reads `KANA_HERMES_ACTIVE_RESTART_FILE`, a path argument, or `acceptance/hermes-active-restart.json`; an absent file is reported with the procedure document the script names (currently this document), never as a pass. It prints `passed`, `casesPassed`, `casesRequired`, and `blockers`, and exits 2 when not passed. A complete result is exactly `passed: true`, `casesPassed: 5`, and an empty `blockers` array.

Top level requires `schemaVersion: 1`, `hermesVersion`, a non-credential `modelProvider`, and `runAt` as an ISO timestamp. Every case needs `status: "pass"` and:

| Field | Rule |
| --- | --- |
| `testedAt` | ISO timestamp |
| `restartPoint` | At least 5 characters describing when the restart happened |
| `connectionStates` | Includes both `reconnecting` and `connected` |
| `terminalOutcome` | One of `resumed`, `completed`, `error`, `aborted` |
| `userPromptCopies` | Exactly 1 |
| `assistantMessageCopies` | 0 or 1 |
| `protectedInputCleared` | `true` for the `approval` and `protected-input` cases |
| `staleProtectedInputAccepted`, `falseBusyState`, `dataLoss`, `credentialExposure` | All `false` |
| `evidence` | At least 10 characters, sanitized, and not credential-shaped |

The five required cases and what each proves:

| Case | Restart point | Proves |
| --- | --- | --- |
| `thinking` | After Kana shows thinking, before an answer | No false busy state while offline; reconnect resumes the running turn or reports one terminal recovery error, and the prompt and final assistant message each appear at most once |
| `approval` | While a benign tool approval is visible | The stale approval dialog clears on disconnect, Hermes reissues a valid request or ends the turn honestly after reconnect, and Kana never answers the old request |
| `protected-input` | While a test-only protected input is visible | The input clears immediately, never enters the transcript, backup, diagnostics, or browser storage, and cannot be submitted after the restart unless Hermes issues a new request |
| `answer-boundary` | After answer bytes exist but before the terminal event reaches Kana | Resume restores one valid structured response or shows one recovery error, and duplicate `message.complete` events do not create duplicate history |
| `after-completion` | Immediately after the finish event | Reconnect does not replay speech, append another assistant message, or resend the user prompt |

Record for every case the date, Hermes version, model/provider without credentials, restart point, connection-state sequence, message counts before and after, whether protected UI was cleared, and any issue id. A case fails when there is a duplicate prompt or message, a hidden busy state, a stale protected-input submission, credential retention, data loss, or a silently replaced missing session. A failing case is recorded as `fail` with sanitized evidence and treated as a supported-environment limitation; it must never be entered as `pass`. The validator cannot recognize conversation content, so evidence must stay sanitized: no prompts, tool output, passwords, tokens, or secret values.