# Response contract

Every normal Hermes assistant turn returns one structured user-facing response that Kana parses into Japanese speech, a subtitle, a language, and an avatar emotion. This document is that contract and what Kana does with a reply that follows or ignores it.

**Read when:** you are changing the persona prompt, the response parser, voice delivery, avatar emotion handling, or how a restored transcript is shown.
**Truth in code:** `lib/presentation/persona.ts`, `app/api/hermes/rpc/route.ts`, `lib/presentation/response-parser.ts`, `lib/presentation/markdown.ts`, `lib/presentation/spoken-reply-queue.ts`, `lib/services/send-message.ts`, `lib/services/agent-event-handlers.ts`, `lib/avatar/avatar-controller.ts`, `lib/voice/tts-relay-provider.ts`

## The reply (response protocol 3)

Hermes starts its final reply with a header between `---` rules, then the answer as Markdown:

```
---
ja: <the same reply as natural spoken Japanese, on one line>
emotion: <neutral | happy | sad | angry | surprised | thinking | confused | excited>
lang: <BCP 47 code of the answer below>
---
<the answer shown on screen; Markdown allowed>
```

While Kana's voice is off the header has no `ja` line, because nothing would read it (`replySkeleton`). The header costs fewer tokens than the old JSON envelope: the answer is not quoted or escaped. `lib/presentation/markdown.ts` renders the answer through a small reader as React elements, never HTML; links survive only for http(s) and mailto.

`parseKanaResponse` returns:

```ts
type KanaResponse = {
  speech_ja: string; // "" when the reply had no Japanese speech
  subtitle: { text: string; language: string };
  emotion?: Emotion;
};
```

It still reads protocol 1/2 JSON envelopes, from restored history and models that keep the old habit, and tolerates what models commonly do: a reply wrapped in a code fence, a missing opening rule (only when the reply starts with `ja:`, or `emotion:` plus a real emotion), quoted values, a `ja` line wrapped onto a second line, and an unknown emotion (becomes `neutral`). Prose written before the header is kept as part of the answer. JSON-looking output that cannot be recovered fails explicitly rather than showing the envelope as a chat bubble.

## How the contract is delivered

The contract rides in the user turn, after the user's words, inside a `<kana>...</kana>` note (`buildKanaUserPrompt`). The note comes last so it is the freshest instruction the model reads, and Hermes still titles the session from the user's own words. Transcript restore strips the note with `unwrapKanaUserPrompt`, which also unwraps the protocol 1/2 `user_message` JSON wrapper and drops trailing attachment references.

- The first prompt after a session opens, new or resumed, carries the full contract; every later prompt carries a short self-sufficient skeleton (`fullContract` / `compactContract`).
- A failed `prompt.submit` keeps the full contract for the retry: it is cleared only once Hermes accepts the prompt (`submitPrompt`).
- Turning Kana's voice on or off sends the full contract again, so the header's `ja` rule matches what will be read. The option is read on every submit (`voiceEnabled`).
- The contract is never sent as a system-role seed on `session.create`: Hermes sends a seed as a second system message that some routes drop before the model sees it, and Hermes never stores it, so a resumed session would lose it anyway.
- The relay appends the owner's `guardrails.rules` from `config.json` inside that same note on every `prompt.submit` (`withKanaRules`), after the screen has allowed the turn. The list is read per turn, so a rule added or edited applies to the next message without a restart, and it is independent of `guardrails.apiKey`: an empty key turns off screening, not the model's instructions. A rule that contains a note tag is neutralized so it cannot end the note early, and trailing attachment references stay after the note.

The full contract tells Hermes what Kana is: a local app that puts an animated avatar and its own voice on top of the session. Kana's avatar, settings, and text-to-speech (the local Irodori engine or Pollinations) belong to Kana, not to Hermes, so a question about "your voice" or "the local TTS model" is about Kana. With the voice on, Kana reads `ja` aloud, so Hermes must never call a TTS tool to speak and makes an audio file only when the user asks for a file. The full contract also states how Hermes config changes reach Kana and that Hermes must never stop or restart `hermes serve`.

## Language rules

- `ja` is always natural conversational Japanese, whatever language the user writes in, and always plain speech: no Markdown, emoji, URLs, or code.
- The answer uses the language of the user's latest message. When that message has no clear language (a command, a name, code, a single ambiguous word), the language of the user's earlier messages carries over. Kana has no subtitle-language setting and sends none.
- `lang` records the language actually used in the answer.
- Writing in another language affects future replies only. Stored history is never retranslated on load.

## Keeping the voice honest

Only Japanese is ever spoken. A `ja` value without Japanese script becomes `speech_ja: ""` (`japaneseSpeech`), and a plain reply that ignored the contract is spoken only when most of its letters are Japanese, otherwise its `speech_ja` is also `""`. Either way the reply is shown at once with no voice.

Kana never speaks the answer text as a fallback and never makes a second translation request. A reply without Japanese speech is revealed immediately (`onAssistantMessage`); one with speech stays hidden until its audio starts, and Stop or a voice failure reveals it (`lib/presentation/spoken-reply-queue.ts`, `lib/services/voice-service.ts`).

## What happens to a parsed reply

The parsed response becomes an `assistant.message` agent event carrying the response and its raw text (`handleMessageComplete`). Kana stores it as an assistant message with the turn's tool activity, drives the avatar emotion, and — when there is Japanese speech and the voice is on — reads `speech_ja` through the configured TTS provider before revealing the text (`onAssistantMessage` in `lib/services/agent-event-handlers.ts`, `lib/voice/tts-relay-provider.ts`).

A reply may also deliver files: the contract asks Hermes to put `MEDIA:/absolute/path` on its own line, which Kana strips from the text and renders as a player or download card (`extractMediaAttachments` in `lib/presentation/media.ts`; the server rewrites the path to a signed link first, see `hermes-contract.md`).

A command whose structured result is `send` or `skill` is submitted to the same session with this same contract, so it goes through `buildKanaUserPrompt` and `parseKanaResponse` like any other turn and never triggers a second model.

## Recovery and edge cases

- Reconnect recovery: when the connection dropped mid-turn, `session.resume` history lets Kana restore the completed structured response instead of losing the turn (`recoverResumedTurn`). A raw reply that cannot be parsed is reported as an agent error, never shown as JSON.
- Plain-text fallback: a reply that ignored the contract is still shown. Its language is unknown, so the subtitle language is `und`, and it is spoken only when mostly Japanese.
- Subtitle language: only a well-formed BCP 47 tag is kept (`/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/`); anything else becomes `und`. A header with speech but no body uses the speech as its own Japanese subtitle.
- Duplicate replies: an adjacent identical assistant reply is dropped, so a reconnect recovery cannot double-post a turn (`onAssistantMessage`).
- Error replies: reserved for genuinely malformed protocol output such as JSON-looking text that cannot be recovered. Ordinary answers, including one that merely mentions `speech:`, are left alone.

## What is stored

Every stored assistant message preserves the exact `speech_ja`, `subtitle.text`, `subtitle.language`, `emotion`, and timestamp that were displayed (`KanaMessage` in `lib/conversation/types.ts`). Rendering history uses the stored subtitle text; `parseHermesTranscript` re-parses each restored Hermes row from the raw reply text Hermes stored, only to recover those fields. Never derive or retranslate a stored subtitle on load.

Emotion drives the avatar through `AvatarController.presentEmotion`: an intensity per emotion plus a motion for `happy`, `surprised`, `thinking`, `confused`, and `excited`. `thinking` is also shown while a turn runs, and `confused` on an agent error.

## Tests

`tests/presentation/persona.test.ts` covers the delivered note (user words first, header shape, voice on/off, what Kana is, and the owner's rules inside the note) and `tests/presentation/response-parser.test.ts` covers the parser (header, fences, missing rule, quotes, non-Japanese `ja`, protocol 2 envelopes, plain-text fallback). `tests/agent/hermes-agent-client.test.ts` covers contract delivery per prompt and the voice-change resend.