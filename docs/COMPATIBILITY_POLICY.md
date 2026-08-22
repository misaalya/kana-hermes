# Release channels and compatibility policy

## Channels

- **Alpha (current):** foundation and migrations may still evolve. Every
  persistent schema change needs a fixture and migration test.
- **Beta:** allowed only after one week of dogfood, target-host Qwen evidence,
  two-model Live2D acceptance, complete restart/recovery matrix, clean quality
  gate, and no P0/P1 issue.
- **Stable:** not defined until beta has run across multiple real installations
  and a minimum Hermes compatibility window can be supported from evidence.

## Hermes compatibility

Kana uses live command catalogs and public `hermes serve` RPCs rather than
copying a version-specific Telegram menu. The minimum *tested* version is
Hermes Agent 0.20.1; this is not yet a promise that older releases work. Unknown
handshakes fail as `incompatible` with an upgrade message. New commands should
appear automatically when Hermes exposes them through the registry.

Kana updates never modify Hermes. Rolling Kana backward means restoring a Kana
package and optional browser backup, not rolling back Hermes.
