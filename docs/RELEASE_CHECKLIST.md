# Kana release checklist

1. Confirm the authenticated npm account may claim or update `kana-alya`,
   choose and record the project license, and verify that the publish guard
   passes. The guard refuses every other package name.
2. Confirm no open credential leak, data loss, duplicate prompt, or wrong-session issue.
3. Update version, user changelog, migration notes, supported Hermes version, and known limitations.
4. Run `npm audit --omit=dev` and review—not blindly auto-fix—every production finding.
5. Run `npm run test:package:npm`. This must inspect, install, and boot the exact
   tarball rather than testing only the source checkout.
   Prereleases publish under the `next` dist-tag; promote a tested version to
   `latest` only after the isolated global-install journey passes.
6. Verify Live2D notices and third-party licenses; do not package user avatar
   assets. If the renderer/sample integration changed, run
   `npm run test:live2d:official`.
7. Run `npm run quality` from a clean checkout with enough disk.
8. Run the temporary Hermes live audit and isolated restart audit without
   sending an LLM prompt; complete the active-turn restart matrix for beta.
9. If Qwen changed, run Python tests and `npm run tts:acceptance` on target
   hardware; preserve its JSON evidence and one intelligibility check.
10. Start `.next/standalone/server.js` from outside the source checkout and run desktop/mobile smoke tests.
11. Create a checksum for the package archive and record exact Node, Kana, Hermes, and optional Qwen versions.
12. Run `npm run dogfood:check`; alpha may retain documented blockers, but beta
    requires a passing report.
13. Write rollback notes: retain the previous package and browser backup; never roll back or patch Hermes as part of Kana rollback.

Architecture decisions are recorded in
[ADR-001](ADR-001-PROCESS-BOUNDARIES.md) and
[ADR-002](ADR-002-TTS-DELIVERY.md).

Alpha may ship with documented limitations. Beta additionally requires one
week of dogfood and no unresolved P0/P1 issue. Stable channel criteria remain a
future decision based on multiple real installations.
