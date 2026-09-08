# ADR-001: Keep Hermes and Qwen outside the Kana application process

Status: accepted, 2026-08-22.

Kana remains a Next.js presentation application. Its Node server may discover,
start, and supervise the user's unmodified `hermes serve` executable, then
holds one server-side WebSocket to it. Kana never patches, updates, vendors, or
writes into the Hermes installation. Hermes therefore remains independently
updatable and is still the only agent.

Qwen3-TTS runs in its own managed Python process. Kana packages the versioned
service source needed to start it, but its Python environment, model cache,
and voice data stay outside the npm or standalone artifact under Kana's data
root. The browser reaches either Qwen or an external OpenAI-compatible TTS
provider only through Kana's same-origin relay.

A native desktop wrapper is deferred. It may be reconsidered only when real
usage demonstrates a need for OS keychain storage, auto-start, or native
updates. Process supervision is already provided by the server runtime for
its loopback dependencies. Any future wrapper must still call public Hermes
interfaces, keep the user's Hermes installation external, and pass the same
browser-level adapter tests. Convenience alone is not enough reason to add a
second packaging and security boundary.
