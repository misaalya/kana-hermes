# ADR-001: Keep Hermes and Qwen outside the Kana web process

Status: accepted, 2026-08-22.

Kana remains a local Next.js presentation application. It does not start,
supervise, patch, update, or bundle Hermes. Qwen3-TTS remains a separately
installed local service and model cache. The standalone Kana package therefore
stays removable and independently updatable.

A native desktop wrapper is deferred. It may be reconsidered only when real
usage demonstrates a need for process supervision, OS keychain storage,
auto-start, or native updates. Any future wrapper must still call public Hermes
interfaces, keep the user's Hermes installation external, and pass the same
browser-level adapter tests. Convenience alone is not enough reason to add a
second packaging and security boundary.
