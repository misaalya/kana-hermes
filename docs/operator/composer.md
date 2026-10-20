# Use the composer

The composer writes the message, attaches files, captures dictation, and picks
the Hermes model. This page covers its controls and limits.

**Read when:** you are attaching files or dictating, or you need to know where an attachment goes.
**Truth in code:** `components/kana/chat-composer.tsx`, `components/kana/live-chat-feed.tsx`, `lib/limits.ts`, `lib/services/send-message.ts`, `lib/services/model-catalog-service.ts`, `app/api/hermes/attachments/route.ts`

## Sending a message

Text sits on the first row; the second row holds the attach button, the
microphone, the current model, and Send. Enter sends and Shift+Enter inserts a
newline. Send keeps its icon while Hermes works; Stop appears beside the working
status in the conversation and remains there while the reply's voice is still
being generated. A plain message typed during a turn follows Hermes's
`display.busy_input_mode`: by default it is redirected into the running turn,
which still answers once; with `queue` it runs as the next turn, and with
`steer` it reaches Hermes after the next tool call. A redirected or steered
message is drawn as a small icon line under the message that opened the turn,
such as `Redirected current turn: '…'`, instead of a bubble of its own.
Approvals, `/status`, `/steer`, `/queue`, `/agents`, `/goal`, `/heartbeat`, and
`/background` may still be sent. A draft typed `/` opens the Hermes command menu
with keyboard navigation.

A draft and its selected files belong to one conversation and live only in the
browser tab's memory, so a reload clears them; each conversation keeps its own
draft for as long as the tab is open.

When the owner has configured the prompt guardrail (`configure.md`), a message
may be refused before it reaches Hermes. Kana keeps your message in the
conversation and answers it with one fixed line instead of a reply, because no
model saw it. The same applies to a slash command and to `/steer`; a refused turn
is not added to the Hermes transcript.

## File attachments

Press the attach button, select files, review the filename chips, and send;
files with no text ask Hermes to review them, in the interface language.

| Limit | Value |
| --- | --- |
| Files per message | 5 non-empty files |
| One file | 10 MiB |
| Combined per message | 20 MiB |
| HTTP request body accepted by Kana | 14 MiB, covering the base64 encoding of the largest message |

Files cannot be combined with a slash command or a running turn, and Kana
reports that instead of dropping them. The browser checks the limits first and
the server validates them again.

The browser posts the bytes to the authenticated `/api/hermes/attachments`
route; Kana stages each file through Hermes's `file.attach` RPC, then submits the
prompt with the `@file:` references Hermes returned, within a 120-second upload
allowance. Kana never treats a browser-supplied path as a server path, and
staging needs a Hermes version that provides `file.attach`.

Hermes owns the staged artifact and its retention; Kana keeps no copy. If
staging fails, nothing was submitted and the draft and files are kept for a
retry; a failure after the message was recorded clears the draft, because the
message is already in the transcript. Kana sends plain file artifacts, not
Hermes's image/PDF vision tiles. Behind Nginx, set `client_max_body_size 14m`
and allow at least 120 seconds for this route (`supported-environment.md`).

## Voice dictation

The microphone dictates in the interface language (Settings → Experience;
`id-ID` or `en-US`). Recognised speech is appended to the current draft, interim
text appears as a status line, and nothing is submitted automatically. Press the
microphone again to stop; a capture ends by itself after at most 60 seconds, and
switching conversation releases the recognition resources. The microphone is
disabled while a turn runs, while a message is sending, and while the voice is
speaking. Dictation uses the browser's Web Speech API and is independent of
Japanese speech output. It needs microphone permission, a secure context, and a
browser with speech recognition, such as Google Chrome or Edge; Firefox has no
recognition and Kana reports Brave as unsupported. The service may be the
browser vendor's online one, so dictation is not guaranteed offline; unsupported
browsers, denied permission, network failures, and silence each show a visible
status. Dictation uses the visitor's microphone, never the server's, and adds no
speech-output provider or credential.

## Model picker

The model button names the model of the open Hermes session; selecting it opens
the provider and model chooser. The list Kana loaded last for this session
appears at once while Kana asks Hermes for it again in the background;
**Refresh list** waits for that full reload. Switching models, running `/model`
or `/reload`, a new session, or a lost connection drops the saved list. The
choice applies to the current Hermes conversation, not to the global
configuration, and Hermes may report that it starts from the next turn. Any
expensive-model confirmation is shown before the switch, and a model change is
refused while a turn is running. Escape closes the chooser, which is also
reachable as Settings → AI model with the same cached list.