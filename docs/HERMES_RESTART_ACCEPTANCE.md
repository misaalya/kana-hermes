# Hermes restart acceptance

This gate verifies Kana against the installed, unmodified `hermes serve`.
Automated adapter fixtures remain useful, but they do not replace restarting a
real Hermes process.

## Automated isolated idle restart

From the Kana repository:

```bash
npm run test:hermes:restart
```

The harness starts the installed Hermes binary twice on a temporary port with a
temporary `HERMES_HOME`. Driving the server-side bridge directly
(`ensureHermesConnection` / `hermesRpc` from `lib/server/hermes-bridge`), it
creates and titles an empty Kana session so Hermes persists it without an LLM
prompt, resumes it from the durable ID, stops the first server, reconnects to
the restarted one, and resumes the same durable session again. It never reads
or writes the user's normal Hermes database and removes only the temporary
home on exit.

Expected result:

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

The command must exit with status 0. Repeated intermediate `error` and
`reconnecting` states are allowed while the server is down; the bridge must
return to connected and resume the same persistent ID after the restart.

## Interactive active-turn matrix

These cases require a configured Hermes model and deliberate timing, so they
are not run by the automated harness and may consume model tokens. Use a
disposable Kana conversation, preserve diagnostics after every case, and never
enter a real password or production secret.

| Case | Restart point | Pass condition |
| --- | --- | --- |
| Thinking | After Kana shows `Kana is thinking`, before an answer | UI leaves false busy state while offline; reconnect resumes a running turn or reports one terminal recovery error; user prompt and final assistant message each appear at most once. |
| Approval | While a benign tool approval is visible | The stale approval dialog is cleared on disconnect. After reconnect, Hermes either reissues a valid request or ends the turn honestly; Kana never submits a response to the old request. |
| Secret/sudo | While a test-only protected input is visible | Input is cleared immediately, never enters transcript, backup, diagnostics, localStorage, or IndexedDB, and cannot be submitted after restart unless Hermes issues a new request. |
| Answer boundary | After answer bytes exist but before the terminal event reaches Kana | Resume restores one valid structured response or shows one recovery error; duplicate `message.complete` events do not create duplicate history. |
| After completion | Immediately after `agent.finished` | Reconnect does not replay speech, append another assistant message, or resend the user prompt. |

For approval mode, use Hermes's live `/approvals` control and a harmless command
such as reading the current directory. For protected input, use only a
temporary test credential and remove it afterward. The exact model/tool setup
is environment-specific; do not weaken global approval policy merely to make
the checklist easier.

Record for each case: date, Hermes version, model/provider, restart point,
connection-state sequence, message counts before/after, whether protected UI
was cleared, and any issue ID. A case fails if there is a duplicate prompt or
message, hidden busy state, stale protected-input submission, credential
retention, data loss, or silent replacement of a missing session.

Enter the sanitized result in
`acceptance/hermes-active-restart.json`, then run:

```bash
npm run hermes:active-check
```

A complete result exits 0 and prints:

```json
{
  "passed": true,
  "casesPassed": 5,
  "casesRequired": 5,
  "blockers": []
}
```

The validator requires one user-prompt copy, at most one assistant-message
copy, `reconnecting` followed by `connected`, no false busy state, no stale
protected-input submission, and explicit no-data-loss/no-credential-exposure
confirmation for every case. Approval and protected-input cases must also
confirm that the old dialog was cleared. Evidence text must be sanitized; do
not put prompts, tool output, passwords, tokens, or secret values in the file.
