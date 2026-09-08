# Release channels and compatibility policy

## Release policy

Kana publishes final semantic versions under npm's `latest` tag. Version 0.2.0
is the current stable release for the tested environment in
[Supported environment](SUPPORTED_ENVIRONMENT.md). Stable releases preserve
documented configuration and stored-data migrations within a major version;
breaking changes require the next major version and an explicit migration note.

Every persistent schema change still needs a fixture and migration test.
Experimental capabilities remain marked in the documentation, such as
sentence-based TTS delivery. A stable package version does not turn an
untested browser, CPU/GPU combination, Linux architecture, or Hermes version
into a supported target.

Long-running field validation (the dogfood journal, target-host Qwen evidence,
custom Live2D packages, and active-turn recovery cases) determines when Kana
can expand the supported-environment claim. It is release evidence, not a
second npm channel.

## Hermes compatibility

Kana uses live command catalogs and public `hermes serve` RPCs rather than
copying a version-specific Telegram menu. The minimum *tested* version is
Hermes Agent 0.20.1; this is not yet a promise that older releases work. Unknown
handshakes fail as `incompatible` with an upgrade message. New commands should
appear automatically when Hermes exposes them through the registry.

Kana updates never modify Hermes. Rolling Kana backward means restoring a Kana
package and optional browser backup, not rolling back Hermes.
