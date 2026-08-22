# Supported environment and compatibility

Kana 0.1.x is an alpha local web application.

## Tested baseline

- Linux x86_64 host with Node.js 22.22.2.
- Next.js 16.3.1 standalone server bound to loopback.
- Current Chromium/Google Chrome desktop and 390 × 844 mobile emulation;
  automated reflow checks cover 320, 360, 390, 768, and 1440 CSS pixels plus
  mobile landscape. A production Chrome profile also passes manifest
  installability and an offline service-worker shell reload.
- Hermes Agent 0.20.1 (2026.8.13) through `hermes serve` JSON-RPC/WebSocket.
  The live audit observed the registry dynamically and does not pin command
  counts as a protocol guarantee.
- Optional Qwen service Python 3.10–3.13 with `qwen-tts==0.1.1` and the pinned
  0.6B CustomVoice revision.
- Official pinned Live2D Haru and Mao samples load and switch in Chrome with
  model-specific `ParamMouthOpenY`/`ParamA` bindings.

Other current Chromium browsers should work but are not a release claim yet.
Firefox and Safari require a future CI target, especially for folder input,
WebGL, Web Audio, and IndexedDB behavior.

## Browser capabilities

Kana needs JavaScript, IndexedDB, local/session storage, WebSocket, Web Audio,
Blob/object URLs, and WebGL for the real avatar. Mock avatar and voice remain
available when WebGL, audio, internet, Hermes, or Qwen is unavailable.

## Storage and hardware

- Kana's web package is small compared with model runtimes; conversation usage
  depends on history length and imported Live2D assets.
- Every imported Live2D folder is shown with its browser-local size. Browser
  quota is implementation-specific.
- Qwen needs an isolated Python environment, roughly 2.3 GB model download,
  and at least 4 GB free disk before setup. CPU works but may be slower than
  realtime. The reference MX330's 2 GB VRAM is not a supported CUDA target.

## Known limitations

- Kana does not start or supervise Hermes/Qwen and is not a signed desktop app.
- Qwen streaming is deferred. Complete WAV is the default; experimental
  sentence delivery plays ordered complete WAV parts and remains opt-in until
  target-host latency evidence supports changing the default.
- History and avatar packages are browser-local; no cloud sync is provided.
- Real restart recovery while every kind of pending Hermes protected input,
  two custom Live2D packages, and real Qwen p50/p95 still need target-host
  acceptance before beta.
