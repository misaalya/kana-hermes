# Kana

**Give your Hermes Agent a face and a voice.**

Kana is a friendly web app that runs on your computer and puts a live2D
avatar, a Japanese speaking voice, and subtitles on top of the
[Hermes Agent](https://github.com/NousResearch/hermes-agent) you already
use. You chat in a cozy little workspace; Hermes keeps doing all the
thinking.

![Kana desktop workspace](assets/screenshots/desktop.png)

## What you get

- **A talking avatar** — an animated Live2D character that reacts with
  expressions while it speaks. Two official sample characters are
  included; bring your own model whenever you like.
- **Japanese voice, your language** — Kana always speaks Japanese out
  loud (a built-in voice is ready from day one) and shows subtitles in
  the language you pick.
- **Your chats stay yours** — everything runs locally on your machine.
  Conversation history lives inside your own Hermes, not in any cloud.

## Quick start

You need [Hermes Agent](https://github.com/NousResearch/hermes-agent)
installed first. Then:

```bash
npm install -g kana
kana
```

That's it. The first run walks you through three things:

1. picking a password for the app,
2. optionally setting up the local voice engine (a one-time download),
3. saying hello to Kana.

Other helpful commands:

```bash
kana setup        # redo the voice setup later
kana doctor       # check that Hermes and the voice engine are healthy
```

To work on Kana itself instead of just using it, see
[AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

![Kana on mobile](assets/screenshots/mobile.png)
