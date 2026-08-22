# Kana beta acceptance handoff

Kana's deterministic local quality gate is complete. Beta remains blocked by
target-environment evidence that cannot be truthfully generated with mocks or
by waiting inside an automated test. This is the shortest complete handoff for
the remaining matrix.

Never record prompts, conversation text, tool output, tokens, passwords,
secret values, private model URLs, or production credentials in acceptance
files. Use disposable conversations and harmless tools.

## Current gate

Run:

```bash
npm run dogfood:check
```

The current expected result is `matrixPassed: 7`, `matrixRequired: 13`, and
`passed: false`. It must remain false until all six target cases below and
seven real dogfood dates pass.

## 1. Hermes-only

Start the unmodified `hermes serve`, select Hermes in Kana, create one new Kana
conversation, send one harmless normal prompt, run `/status`, reload the page,
and continue the same conversation.

Pass only when the linked durable session remains the same, the user prompt is
stored once, the assistant response is stored once, `speech_ja` is Japanese,
the selected subtitle is preserved, and no false busy/error state remains.

Then record `hermes-only` with `npm run dogfood:matrix` as documented in
`docs/DOGFOOD.md`.

## 2. Hermes restart while active

Follow every case in `docs/HERMES_RESTART_ACCEPTANCE.md`. Fill
`acceptance/hermes-active-restart.json` with sanitized observations and run:

```bash
npm run hermes:active-check
```

Success is exactly `passed: true`, `casesPassed: 5`, and an empty `blockers`
array. Only then mark `hermes-restart-active` passed.

## 3. Qwen3-TTS on the VPS

Follow `docs/QWEN3_TTS_VPS_ACCEPTANCE.md`; heavy inference is intentionally not
required on the development laptop. The automated benchmark must exit 0 and
end with:

```json
{
  "contractPassed": true,
  "baselineComplete": true,
  "cancellationPassed": true,
  "passed": true
}
```

Also listen to one generated WAV and confirm intelligible Japanese. In Kana,
enable Qwen, play one Hermes response, press Stop during a later response, and
replay the completed previous response. Pass only when Stop prevents stale
audio/lip sync and Replay makes no Hermes request. This supplies evidence for
`hermes-qwen` and `qwen-cancel-and-replay`.

## 4. Two user Live2D packages

Use two legally permitted user packages with different mouth/expression or
motion bindings. Haru and Mao prove the official remote sample path but do not
replace this user-package check.

For each package: import the complete folder, configure and preview the mouth,
emotion, motion, and talking bindings, save, reload, and reselect it. Switch A
→ B → A; then delete B and confirm A and its bindings remain. A corrupt or
incomplete package must leave the previous avatar active. Only then mark both
custom model rows passed.

## 5. Seven-day dogfood

For every real usage date run, for example:

```bash
npm run dogfood:record -- \
  --minutes 45 \
  --scenario hermes-only \
  --notes "Sanitized operational result only."
```

Seven distinct dates spanning at least seven calendar days are required. Any
data loss, credential exposure, or unverified P0/P1 issue keeps beta blocked.

## Final commands

After all evidence is present:

```bash
npm run quality
npm run test:live2d:official
npm run test:hermes:restart
npm run hermes:active-check
npm run dogfood:check
npm audit --omit=dev --audit-level=high
```

Beta is ready only when every command exits 0, `dogfood:check` reports 13/13
and seven days, target Qwen evidence is preserved, and no P0/P1 issue remains
open or merely fixed without verification.
