# Kana Architecture

Diagrams first, words second. This page is for a human trying to picture how
Kana works. For agent-facing rules see `AGENTS.md`; for threat model see
`docs/SECURITY.md`.

## The big picture

Kana is a web presentation layer. It never talks to a model directly and
never runs one. Everything intelligent happens inside an unmodified
`hermes serve` process on your machine.

```
   your browser                          your machine
┌──────────────────┐   same-origin   ┌─────────────────────────────┐
│ React UI         │────────────────►│ Kana Next.js server          │
│                  │                 │                             │
│ chat feed        │  POST           │  /api/hermes/rpc            │
│ sidebar          │  /api/hermes/rpc│  /api/hermes/events (SSE)   │
│ composer         │  GET            │  /api/kana/sessions         │
│ avatar canvas    │  /api/hermes/   │  /api/kana/activities       │
│ audio playback   │  events (SSE)   │  /api/voice/tts/*           │
└──────────────────┘                 └──────────┬──────────────────┘
                                                │ ONE WebSocket,
                                                │ server-held token
                                                ▼
                                   ┌─────────────────────────────┐
                                   │ hermes serve  (official)     │
                                   │ agent loop, tools, files,    │
                                   │ MCP, memory, session DB      │
                                   └─────────────────────────────┘
```

Three facts to keep in mind:

- The browser never sees a Hermes token. The Kana server owns the single
  WebSocket connection and relays for every tab.
- The transcript lives in Hermes' own database. Kana re-reads it on demand;
  it keeps no durable copy of messages.
- TTS is a separate local process (`services/qwen3-tts/server.mjs`, pure-C
  engine). The browser reaches it only through `/api/voice/tts/*`.

## One chat turn

What happens when you press Enter on a normal message:

```
composer text
    │
    ▼
use-kana-controller
    │  append optimistic user bubble (exactly what you typed)
    │
    ▼
HermesAgentClient ── wraps the text ──► prompt.submit over relay
    │                       ▲
    │                       │ wrapper = metadata header +
    │                       │ { "kana_request": …, "user_message": … }
    │
    │              hermes serve runs its agent loop
    │              (tools may run; events stream back)
    │
    ▼
message.complete event ──► parse JSON envelope:
                           speech_ja (Japanese voice line)
                           subtitle  (your language)
                           emotion
    │
    ▼
hold for voice ──► Qwen3-TTS renders speech_ja
    │                  │
    │   audio starts   │ failure/abort → show text anyway
    ▼                  ▼
bubble appears ◄── commit message
```

The wrapper is plumbing between Kana and Hermes. It is stored verbatim by
Hermes, so Kana unwraps it again when restoring history (next section).

## Refresh or resume: rebuilding the screen

Nothing about the conversation is stored in the browser across refreshes.
After a reload Kana rebuilds everything from Hermes:

```
page load
    │
    ├──────────────────────────────┐
    ▼                              │
GET /api/kana/sessions             │
(session.list, source="kana")      │
    │                              │
    ▼                              ▼
pick most recently active    open its Hermes session
non-empty session            (session.resume)
    │                              │
    │              full transcript comes back in the response
    │                              │
    │                              ▼
    │                 lib/conversation/transcript-restore.ts
    │                    ├── user rows: unwrap kana_request,
    │                    │   show only what was typed
    │                    ├── assistant rows: parse speech/subtitle/
    │                    │   emotion envelopes
    │                    └── tool rows: fold into per-turn activity
    │
    ▼
sidebar ordered by Hermes'
last-activity order (array
order is authoritative)
```

Slash commands, approvals, sudo prompts and clarification questions ride the
same two pipes: JSON-RPC out through `/api/hermes/rpc`, dedicated events back
on the SSE stream.

## Voice pipeline

```
speech_ja ──► /api/voice/tts/speech ──► qwen3-tts adapter
                                          │ spawns pure-C engine CLI
                                          │ one process per request
                                          ▼
                                     24 kHz WAV
                                          │
browser ◄── audio decoded via Web Audio ──┘
    │
    └──► mouth openness ──► Live2D lip sync
```

Cancel = kill the engine child process. There is no streaming synthesis yet;
long replies are delivered whole (an experimental sentence mode splits them
client-side without new model calls).

## Avatar pipeline

```
Live2DAvatarProvider
    └── PixiLive2DRuntimeAdapter (pixi.js + Cubism Core)
          ├── official Haru / Mao samples (pinned upstream URLs)
          ├── hosted .model3.json URL, or
          └── folder import persisted in IndexedDB
                  │
emotion / talking / motions / gaze ──► canvas, center stage
```

If any layer fails to load, an honest placeholder state is shown instead of a
fake avatar.

## Hard boundaries

```
Kana owns:                Hermes owns:              Nobody else:
  layout & styling          reasoning                 —
  subtitle language choice  tool execution
  activity log (SQLite)     filesystem access
  TTS playback UX           session storage
  avatar rendering          memory / compaction
```

Kana must stay replaceable skin + controls. If a feature needs a second
model, a second agent loop, or a patched Hermes, it does not belong in Kana.

## Where things live

| Question | File |
| --- | --- |
| State brain (what happens when) | `lib/state/use-kana-controller.ts` |
| Relay client (RPC + SSE) | `lib/agent/hermes/hermes-agent-client.ts` |
| Server-held WebSocket | `lib/server/hermes-bridge.ts` |
| Persona + prompt wrapping | `lib/presentation/persona.ts` |
| Transcript rebuild after refresh | `lib/conversation/transcript-restore.ts` |
| Sidebar recency plan | `lib/conversation/session-recency.ts` |
| Per-turn activity log | `lib/server/activity-store.ts` |
| TTS adapter | `services/qwen3-tts/server.mjs` |
