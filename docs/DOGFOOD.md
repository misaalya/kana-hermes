# Kana dogfood and beta gate

Dogfood is release evidence, not a checkbox to fill retrospectively. Keep the
tracked structure in `dogfood/journal.json`; do not put prompts, conversation
text, tokens, passwords, secret values, or private tool output in it.

## Daily entry

Add one entry for every calendar day Kana was used:

```json
{
  "date": "2026-08-23",
  "minutes": 45,
  "scenarios": ["mock-only", "refresh-and-resume"],
  "notes": "Short operational note without private content.",
  "dataLoss": false,
  "credentialExposure": false
}
```

Prefer the recorder so dates, scenario names, duplicate days, and obvious
credential-shaped notes are validated before the file changes:

```bash
npm run dogfood:record -- \
  --minutes 45 \
  --scenario hermes-only \
  --scenario refresh-and-resume \
  --notes "Session resumed once; no private content recorded."
```

The date defaults to today in `Asia/Jakarta`. Use `--date YYYY-MM-DD` only for
a real earlier observation. An existing day is never overwritten unless
`--replace` is supplied deliberately. Record an incident honestly with
`--data-loss` or `--credential-exposure`; never omit it to make the gate pass.

Seven distinct dates spanning at least seven calendar days are required. A day
with data loss or credential exposure fails the beta gate even if the issue was
not entered separately.

## Matrix evidence

Change each required matrix row from `pending` to `pass` only after it was run
in the named environment, and add a concise evidence reference. Use `fail` when
the expected behavior did not occur. The two custom Live2D rows must represent
different user packages/bindings; the official Haru and Mao acceptance samples
do not count as those user packages.

After completing a matrix case, update it without manually editing JSON:

```bash
npm run dogfood:matrix -- \
  --id hermes-only \
  --status pass \
  --evidence "Kana 0.1.0-alpha, Hermes 0.20.1, one prompt/one reply, 2026-08-23"
```

The recorder rejects unknown IDs and obvious credential-shaped evidence. It
cannot recognize private conversation content, so evidence must still stay
sanitized.

## Issues

Issue entries use this shape:

```json
{
  "id": "KANA-001",
  "title": "Short non-sensitive summary",
  "severity": "P1",
  "status": "open",
  "frequency": "2/5 attempts",
  "provider": "hermes",
  "reproduction": "Sanitized steps only",
  "dataLoss": false
}
```

Allowed severity is `P0` through `P3`; status is `open`, `fixed`, `verified`,
or `wontfix`. Beta is blocked by any open or merely fixed P0/P1. A fix must be
verified in the affected environment before it stops blocking the gate.

Run the deterministic gate report at any time:

```bash
npm run dogfood:check
```

The command exits 0 only after the seven-day window, complete passing matrix,
no data/credential incident, and no unverified P0/P1 issue. Until then, its
non-zero result is expected and lists exactly what remains.
