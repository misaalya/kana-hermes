# Dogfood evidence

The field-validation journal records what real daily use of Kana showed, so a compatibility claim rests on observed days rather than a checkbox.

**Read when:** you record a day of real use, update a matrix row, or explain why `npm run dogfood:check` is not a pass yet.
**Truth in code:** `scripts/dogfood-journal.mjs`, `scripts/dogfood-schema.mjs`, `scripts/dogfood-check.mjs`, `scripts/package-standalone.mjs`

`dogfood/` is ignored in `.gitignore`, so the journal is this machine's local evidence, never a repository file. `scripts/dogfood-journal.mjs` carries the canonical empty journal and creates `dogfood/journal.json` itself the first time a day is recorded: `loadJournal` returns the empty journal on `ENOENT`, and `writeAtomic` makes the parent directory before it renames the temporary file into place. A checkout that has never recorded a day simply has no journal.

## Record a day

```bash
npm run dogfood:record -- \
  --minutes 45 \
  --scenario hermes-only \
  --scenario refresh-and-resume \
  --notes "Sanitized operational note only."
```

A recorded day is one entry saying how long Kana was used and which scenarios were exercised. The date defaults to today in `Asia/Jakarta`; pass `--date YYYY-MM-DD` only for a real earlier observation. An existing day is never overwritten unless `--replace` is supplied deliberately. Record an incident honestly with `--data-loss` or `--credential-exposure` rather than leaving it out to make the gate pass. `--file` chooses another journal path.

Validation before the file changes: `--minutes` must be an integer from 1 to 1440, `--notes` at least 3 characters, and at least one `--scenario` whose name is one of the required matrix ids. `rejectSensitiveText` refuses notes over 1000 characters and text that looks like a credential (a `token=…`-style assignment, a private key, or a URL with a user and password).

## Matrix evidence

Each required row starts `pending` and moves to `pass` or `fail` only after the case ran in the named environment:

```bash
npm run dogfood:matrix -- \
  --id hermes-only \
  --status pass \
  --evidence "Kana 0.4.1, Hermes 0.20.1, one prompt and one reply, 2026-09-08"
```

`--status` is `pending`, `pass`, or `fail`. A pass or fail needs a sanitized evidence reference of at least 3 characters; a `pending` row clears its evidence. Unknown ids and credential-shaped evidence are rejected. The two `custom-live2d-model-*` rows must describe two different legally permitted user packages; the official Haru and Mao samples do not count as them.

The required ids, from `scripts/dogfood-schema.mjs`:

| Id | Id | Id |
| --- | --- | --- |
| `mock-only` | `hermes-only` | `hermes-local-voice` |
| `offline-avatar-fallback` | `custom-live2d-model-a` | `custom-live2d-model-b` |
| `refresh-and-resume` | `hermes-restart-idle` | `hermes-restart-active` |
| `voice-cancel-and-replay` | `mobile-installable-web-app` | `backup-restore` |
| `subtitle-history-preservation` | | |

## Journal shape

```json
{
  "schemaVersion": 1,
  "startedAt": "2026-08-23",
  "days": [
    {
      "date": "2026-08-23",
      "minutes": 45,
      "scenarios": ["hermes-only"],
      "notes": "Short operational note without private content.",
      "dataLoss": false,
      "credentialExposure": false
    }
  ],
  "matrix": [{ "id": "hermes-only", "status": "pass", "evidence": "Kana 0.4.1, Hermes 0.20.1, one prompt and one reply, 2026-09-08", "verifiedAt": "2026-09-08T00:00:00.000Z" }],
  "issues": []
}
```

`schemaVersion` must be `1` or the recorder refuses the file. `startedAt` is set from the first day recorded. The `issues` array is hand-maintained; the check treats an issue with severity `P0` or `P1` whose status is not `verified` or `wontfix` as blocking, and likewise a `dataLoss` issue that is not verified.

## What the check reports

```bash
npm run dogfood:check
```

`scripts/dogfood-check.mjs` reads `KANA_DOGFOOD_FILE`, a path argument, or `dogfood/journal.json`, and prints `passed`, `distinctDays`, `spanDays`, `matrixPassed`, `matrixRequired`, `blockingIssueCount`, and a `blockers` array. It exits 0 only when every required matrix row passes with an evidence note, at least seven distinct days span at least seven calendar days, no day records data loss or credential exposure, and no blocking issue remains. Otherwise it exits 2 and lists exactly what is left. An absent journal is reported with the `npm run dogfood:record` command that creates one, and the check never invents evidence of its own.

## Privacy

Evidence stays sanitized: no prompts, conversation text, tokens, passwords, secret values, or private tool output. The recorder catches an obvious credential shape and refuses an unknown scenario, but it cannot recognize conversation content, so the notes and evidence you write are still your responsibility.