# ADR-001: Keep Hermes and the voice engine outside the Kana application process

Status: accepted, 2026-08-22.

Kana remains a Next.js presentation application. Its Node server may discover,
start, and supervise the user's unmodified `hermes serve` executable, then
holds one server-side WebSocket to it. Kana never patches, updates, vendors, or
writes into the Hermes installation. Hermes therefore remains independently
updatable and is still the only agent.

Local speech runs in separate irodori-c engine processes, one per utterance
(updated 2026-09-15; this replaced a managed Qwen3-TTS Python service). The
engine release and model are not packaged: Kana downloads and verifies them on
request into its data root. The browser reaches either the local engine or an
external OpenAI-compatible TTS provider only through Kana's same-origin relay.

A native desktop wrapper is deferred. It may be reconsidered only when real
usage demonstrates a need for OS keychain storage, auto-start, or native
updates. Process supervision is already provided by the server runtime for
its loopback dependencies. Any future wrapper must still call public Hermes
interfaces, keep the user's Hermes installation external, and pass the same
browser-level adapter tests. Convenience alone is not enough reason to add a
second packaging and security boundary.
