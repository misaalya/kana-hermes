# Release channels and compatibility

Kana publishes through one public npm channel. This document states what a
stable version promises, and where compatibility with Hermes ends.

**Read when:** you are deciding whether to upgrade Kana, or how far a release's support goes.
**Truth in code:** `package.json`, `cli/package.json`, `scripts/assert-npm-release.mjs`

## Release channels

- The public package is `kana-alya`; the source app is the private `kana-app`,
  and the publish guard refuses a mismatch or another public package name.
- `cli/package.json` sets `access: public` and the `latest` dist-tag. Kana
  publishes only final semantic versions; the guard refuses a prerelease version
  pointed at `latest`.
- The guard also refuses an unlicensed package and a dirty working tree, so a
  published artifact matches a committed revision.
- Versions 0.2.0-alpha.1 through 0.3.2 were removed from npm; install 0.4.0 or
  later.
- There is no second npm channel. Field validation — the dogfood journal,
  target-host voice evidence, custom Live2D packages, and active-turn recovery
  cases — is release evidence, not another tag.

## Compatibility policy

Stable releases preserve documented configuration and stored-data migrations
within a major version; a breaking change requires the next major version and an
explicit migration note, and every persistent schema change still needs a
fixture and a migration test.

A stable version number does not turn an untested browser, CPU, Linux
architecture, or Hermes version into a supported target; the tested baseline and
its limits are in `supported-environment.md`. Experimental capabilities remain
marked as such, for example sentence-based TTS delivery.

Kana updates never modify Hermes. Rolling Kana backward means restoring a Kana
package and an optional browser backup, never rolling back or patching Hermes.

## Hermes compatibility

Kana reads the live command catalog and public `hermes serve` RPCs instead of
copying a version-specific command list, so commands Hermes adds appear in Kana
without a Kana change. The minimum tested Hermes version is 0.20.1; older
releases are not a compatibility promise. A gateway Kana cannot complete the
handshake with leaves the workspace showing its connection state, and unknown
methods are rejected by the relay allow-list instead of being forwarded.