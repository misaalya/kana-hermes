# Composer: files, dictation and models

The composer keeps Kana's existing theme. Text occupies the first row; the
bottom row contains **+**, microphone, active model and an upward-arrow **Send**
button. While Hermes or TTS is working, Send becomes **Stop**. Enter sends;
Shift+Enter inserts a newline. Slash commands retain their keyboard menu.

## Files

Click **+**, select files, review the filename chips, and send. Remove a chip
with its × button before sending. You may send files without text; Kana then
asks Hermes to review them. Limits: five non-empty files, 10 MiB each, 20 MiB
combined per message. File selection is held in browser memory per conversation;
reload clears unsent files. Failed uploads retain the draft and selected files.

The browser uploads bytes to the authenticated `/api/hermes/attachments` relay.
The Hermes adapter stages each file through the official `file.attach` RPC and
then submits the prompt with Hermes's returned `@file:` references. This requires
a Hermes version supporting `file.attach`. Kana never passes a browser-local
path as a server path and never reads a user-supplied server filesystem path.
Hermes owns the staged artifacts and their retention. Stopping an upload prevents
the associated prompt; files already staged may remain in Hermes's workspace.

Attachments are readable file artifacts. This does not implement Hermes's
separate image/PDF vision-tile attachment API. Hermes's model and available tools
determine how each format can be inspected. Uploads go to the machine running
Hermes, including a user's VPS.

For nginx, add `client_max_body_size 14m;` to the Kana server/location block and
allow at least 120 seconds for the attachment relay. The 14 MiB transport allowance
includes base64 encoding overhead. Next's proxy buffer is configured for the same
allowance; the authenticated route enforces the smaller decoded-file limit.

## Voice input

Click the microphone and speak in the interface language (Settings → Experience). Final recognized
speech is appended to the current draft; interim recognition appears as a status.
Review or edit the text and click Send. Kana never automatically submits dictated
text. Click the microphone again to stop; a capture ends after at most 60 seconds.
Switching conversations or leaving the composer releases recognition resources.

Dictation uses the browser's **Web Speech API**, independently of Japanese TTS.
It requires microphone permission, HTTPS (or localhost), and a browser/service
that supports speech recognition, such as Google Chrome. It is not available in
every browser or Chromium build (Firefox has no recognition; Brave exposes the API
but cannot reach a recognition service, so Kana reports it as unsupported); recognition may use the browser vendor's online
service and is **not guaranteed offline**. Unsupported browsers, denied permission,
network failures and no speech produce a visible status instead of silently doing
nothing. See [MDN's SpeechRecognition documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

On a VPS, the microphone still belongs to the visiting user's browser. Kana does
not invoke Hermes's `voice.record`, which captures the server machine's microphone.
Speech output still uses the existing server `tts.provider` setting, playback
queue and Live2D lip sync; dictation adds no TTS provider or credentials.

## Model choice

Click the model name to load Hermes's current provider/model catalog. Select the
provider and model, then apply. Any expensive-model confirmation from Hermes is
shown before switching. The change applies to the current Hermes conversation,
not the global configuration. Model changes are blocked while a turn is running.
Escape closes the chooser and returns focus to its button. The existing settings
model panel uses the same controller and Hermes model-selection implementation.
