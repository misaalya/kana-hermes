# UI direction

Kana uses its own cozy game-menu style, in Kana's colours. It is soft, round,
and friendly, but it stays a calm workspace rather than an ornamental
dashboard. This is a product direction, not a temporary theme.

**Read when:** you are changing any component, `app/globals.css`, the composer, Settings, the avatar library, the chat feed, a stage pattern, or the fatal error pages.

**Truth in code:** `app/globals.css`, `app/error.tsx`, `app/global-error.tsx`, `components/kana/chat-composer.tsx`, `components/kana/chat-dock.tsx`, `components/kana/focus-rail.tsx`, `components/kana/conversation-sidebar.tsx`, `components/kana/live-chat-feed.tsx`, `components/kana/header-host-monitor.tsx`, `components/kana/mobile-host-panel.tsx`, `components/kana/workspace-header.tsx`, `components/kana/settings-avatar-cards.tsx`, `components/kana/kana-select.tsx`, `components/kana/config-guide.tsx`, `app/docs/page.tsx`, `lib/ui/copy.ts`, `lib/presentation/markdown.ts`, `lib/presentation/json-highlight.ts`, `scripts/generate-stage-patterns.py`

## Colours

Colours are Kana's originals, defined in `app/globals.css` and exposed to
Tailwind through `@theme inline`: the white/grey neutrals (light `#f4f4f2` /
`#ffffff`, dark `#1c1c1c` / `#242424`), the brand blue `--accent` `#599dc6`
with `--accent-hover`, `--accent-strong`, `--on-accent`, `--chat-frame`,
`--chat-bubble`, the success green `--success` used by the voice-engine download
action, and the stage-pattern inks. Do not tint the neutrals or add new shades
of blue; style through the tokens.

## Flat shapes, no shadows

No shadows of any kind: no drop shadows, no flat "ledge" shadows, no glow.
Pieces are flat colour shapes separated by fill, radius, and spacing.

## Scrolling

Kana draws no scroll line anywhere. The global `scrollbar-width: none` and
`::-webkit-scrollbar { display: none; }` in `app/globals.css` hide every
scrollbar, including the transcript, settings, dialogs, and code blocks. Those
surfaces still scroll with the wheel, trackpad, touch, and keyboard, so a hidden
scrollbar never removes a way to reach the content.

## Typeface

One typeface, M PLUS Rounded 1c (`next/font/google`, variable
`--font-kana-sans`, weights 400–800), for Latin UI text and Japanese subtitles
alike. Headings and pills use the heavy weights (700–800).

## Component vocabulary

Components share a small vocabulary (shared classes in `app/globals.css`):

- Header actions are a blue pill tray (`kana-bar`) of round tabs. An open tab
  turns into the white disc, and a label bubble (`kana-tip`) appears under a tab
  while it is pointed at or open.
- On a desktop the header's safe middle band carries the host widget cards (the
  monitor, the local/server clock, and the date) in the fixed LEFT, CENTER, and
  RIGHT zones described under Header host widgets below.
- The conversation title is a blue name chip.
- Buttons are heavy pills (`kana-pill`, with `kana-pill-accent` striped blue for
  primary actions and `kana-pill-soft` for secondary ones) that hop up on hover.
- Choices are rounded cards (`kana-choice`). The selection is a blue ring plus a
  round check badge (`kana-check`) on the corner.
- Settings → Avatar is the avatar library (`kana-wardrobe`,
  `settings-avatar-cards.tsx`). Cards wrap in a grid, never a carousel or rows of
  buttons. An avatar card is its stage portrait on a soft blue disc over its
  name; an imported one keeps its size, with Rename and Remove in a ⋯ menu on
  its top-left corner. Background cards are a 16:10 preview over the name. Each
  grid ends with a dashed card with a blue "+" disc that adds one (import Live2D,
  upload an image).
- Segmented controls are a pill track with a sliding blue thumb.
- In-content section labels are small rounded bubbles (`kana-label-bubble`), but
  the Settings sidebar group labels ("Personal", "System") are plain muted text.
  Disclosures lead with a round "+" / "–" disc. Dividers are dotted.
- Dropdowns are the custom `KanaSelect`, never a native `<select>`. Long lists
  (models, and providers past eight) pass `search` for a filter field, and the
  list is `position: fixed` so dialogs never clip it.
- Log out and other leave-the-app actions use the red `kana-pill-danger` with an
  icon.
- Icons are two-tone solid SVGs (`DuoIcon`): the main part in the current colour,
  the supporting part in the soft tone. Their meanings are fixed:

| Icon | Meaning |
| --- | --- |
| Sun / moon | Theme |
| A small box growing into a big one | Avatar layout ("Scale") |
| Clock | Conversation history |
| Hexagon | Settings |
| Globe | Language and Experience settings |
| Waveform | Kana's voice settings |
| Avatar figure | Avatar settings |
| Bot | AI model, never a sparkle |
| Star | Kana's default model |
| Server | Deployment and server settings |
| Shield | Security settings |

## Fields

Text, number, and password fields use `kana-field`: a grey pill at rest that
turns white with one solid accent ring while active. There is no browser field
chrome at all (focus ring, search clear button, spinners, password reveal,
autofill tint); a search field draws its own clear button.

## The avatar layout popover

The avatar layout popover has no title or hint, only reset/close and the Size, X,
and Y sliders. Sliders are `kana-range`: a thick accent-filled pill with no knob,
like a console volume bar.

## Square corners

Modals have square corners: this is Kana's signature. That covers Settings, the
setup screens, conversation history, the Hermes approval/input dialog, the
connection gate, the composer's model chooser, and the avatar layout ("Scale")
popover. The Settings sidebar items (`kana-settings-nav-item`, the selected one
included) are square too. The chat panel, the desktop focus rail, and
conversation rows are square as well. Controls inside a modal keep their
rounded shapes, and the greeting dialogue box (`kana-greeting`) is not a modal.
On phones the
sidebar becomes a sideways tab row that scrolls the active tab to its centre,
so a selected section is never left half cut at an edge.

On phones, a Settings row with a short control — the Show avatar switch and
Installation mode — keeps its label and control on one line; rows with wide
controls stack. Installation mode reads Remote when `hermes.remote` is
configured, otherwise Deployment or Local from `deployment.mode`.

Settings → Connection ends with the Host card: the hostname and OS line, then
a 2×2 grid of flat tiles for CPU/load, memory, root disk, and uptime. CPU,
memory, and disk carry a thin accent bar with their percentage and usage;
uptime carries Kana's own uptime and RSS. With `hermes.remote` configured, the
same card samples the remote Hermes dashboard's `/api/system/stats` instead:
the hostname/OS line and host metrics are the remote machine's, and the uptime
detail names the Hermes process at `Hermes <uptime> · <RSS>`. There is no live
label; a failed poll keeps the last values and shows an error line. Nothing is
charted or stored, and the card polls only while it is mounted.

Floating surfaces and dialogs keep themselves inside the window horizontally:
`useShiftIntoViewport` measures the surface and shifts it right when it crosses
the left edge, left when it crosses the right edge. The Settings shell moves
with relative `left` (so its fixed-position dropdowns still measure from the
viewport); menus move with `translate` so their entrance transform still
composes. A menu or dialog is never cropped at the window edge.

## Header host widgets

On a desktop, the header's safe middle band between the conversation name chip
and the tool tray holds three widget cards. The monitor shows CPU, memory, and
disk as big values over 20 square accent ticks, then uptime with Kana's own
uptime and RSS. With `hermes.remote` configured it shows the remote Hermes
host's CPU, memory, and root disk, its uptime, and the Hermes process at
`Hermes <uptime> · <RSS>`; the card's hostname is the remote host's. The clock
shows the browser's local time beside the server clock, each with its zone; the
server clock is anchored to `/api/kana/host`'s server time and zone and is
corrected on every poll. The date follows the browser. Each card is a neutral
`surface-strong` block in dark mode and the chat panel's `surface` in light
mode, with a 12 px radius and a thin dim inset stroke that turns Kana blue only
while the card is lifted for a drag; the monitor splits its cells with dotted
rules.

The cards live in three fixed zones, LEFT, CENTER, and RIGHT, each holding any
number of cards with one 10 px gap. LEFT packs from the band's left edge in
its saved order. RIGHT packs from the band's right edge with the first saved
card rightmost. CENTER is one block whose offset is `(band - block width) / 2`,
so it re-centres whenever a card enters or leaves. Zone widths come from the
cards' measured widths, never a fixed zone size. When a block would cross the
band or touch its neighbour, cards step out of view until the blocks clear. A
side block meeting CENTER yields a CENTER card first (normally the clock, so a
date placed beside the monitor stays visible); a LEFT and RIGHT touch with no
CENTER block yields the RIGHT card; a block wider than the band drops its own
lowest-priority card. Within one zone the yield order is date, then clock, then
monitor. A hidden card keeps its place in the saved layout and returns when
there is room.

Dragging any card starts only after the pointer moves 5 px, so a click is not a
drag. After that the card is held under the pointer in both axes, slightly
scaled. While the pointer is within 40 px of the band, the held card's own
centre chooses the target, not the pointer's third of the band: it is measured
against the block each zone would have without that card (or the zone's edge
when that block is empty), the nearest block wins, and the card is inserted at
that block's nearest gap by centre. The zone already previewed keeps the target
until another is more than 12 px closer, so the gap does not flicker between
neighbours. The cards already there slide to leave the gap, with no insertion
line drawn. Moving farther away clears the gap; a release there cancels the
move. A drop inside the proximity settles the held card back into the header
row at the gap, recomputes the zones, and saves the zone and order as
`hostWidgetLayout` in the local preferences. An invalid saved layout falls back to monitor LEFT,
clock CENTER, date RIGHT. The cards never cover the conversation name chip or
the tool tray, take no input beyond their drags, poll the host only while
mounted, and are absent on phones. On phones the same CPU, memory, disk, and
uptime readings live behind a right-edge tab shaped like the chat dock's
handle: opening it slides in a slim rail under the header, its four readings
stacked with a dotted rule between them. The rail is typographic rather than
instrument-like: each metric sets its small uppercase label above a large,
right-aligned reading and nothing else, so the readings carry the data on their
own. Uptime stacks its hours and minutes over Kana's own uptime and RSS, and the
clock and date stay desktop-only. The rail hugs its readings instead of running
down to the composer, capped by the space above the composer so overflow
scrolls inside it. It keeps its height while closed, so the tab stays put
instead of jumping to the top, and the last reading stays cached: a sample
younger than 15 seconds is reused instead of requesting the host again. It
polls only while open.

## Conversation history

Conversation history has no "Recent" label. A dotted stroke like the Settings
sidebar edge, inset to the search field's edges with room above and below,
separates the search from the list. Only a search result count gets a label
bubble. A conversation row is square and plain until hovered. The open
conversation is a square, dimmed neutral block (`surface-strong`) with ordinary
ink: no accent fill, stroke, or corner check badge. It is a real dim, not a
tinted or desaturated blue.

## Settings

Settings is to the point: a group title, then rows of a short label and its
control. No descriptions, hints, or explainer paragraphs under titles, rows,
cards, or buttons; if a label needs one, find a clearer label. The only text
beyond labels is live status, errors, the voice clone consent, and the required
Live2D sample notice. `SettingsGroup` takes an `action` that sits right after the
title (never at the far right, where the dialog's close button is). Advanced
configuration's action is the "Guide" link to `/docs`, opened in a new tab.

## Chat-only mode

The Avatar section opens with one row, "Show avatar"
(`preferences.avatarVisible`, default on, anything but `false` in a stored or
restored record). Off is a chat-only workspace: the avatar layer goes
`visibility: hidden` so the canvas keeps its box and the WebGL runtime stops its
ticker, while the room's pattern stays as the wallpaper. On a desktop the
workspace becomes two surfaces (`components/kana/focus-rail.tsx`): a persistent
conversation rail on the left, holding the same list, search, and New action as
the History dialog, and a chat panel that fills the space to its right
(`is-sole`), from 16 px past the rail to 16 px from the window edge, while the
transcript keeps a wider, centred measure inside it. The rail
spans from the header down to 16 px above the bottom, is 264–288 px wide, and
its footer holds "Show avatar", which turns the stage back on; notices start to
the right of the rail. The History dialog still works. Below 1024 px the chat
keeps the full viewport and history stays in the dialog. The phone tile and the
hide-chat tab disappear, and the "Scale" header tab is not rendered. Kana's
first-run greeting always keeps the stage and hides the rail, because it
introduces her face to face.

## The config guide at /docs

`/docs` is the config guide (`components/kana/config-guide.tsx`). Its content is
plain Markdown, one file per language in `content/docs`
(`configuration.id.md`, `configuration.en.md`), read at build time by
`app/docs/page.tsx` and rendered with the chat's own parser and renderer
(`lib/presentation/markdown.ts`, `renderMarkdownBlocks` in `chat-markdown.tsx`),
never a second Markdown library.

Structure and content:

- `# Title` names the page; every `## Section {#id}` is a sidebar entry whose id
  (shared by both languages, see `CONFIG_GUIDE_GROUPS`) drives deep links and
  icons; a fenced `kana-config-path` block shows this installation's config path;
  write each paragraph on one line (a single newline is a line break in the chat
  parser). Settings go in Markdown tables.
  `tests/presentation/config-guide.test.ts` checks the structure and runs every
  JSON example through the real config parser.
- The page is task-oriented for a person who may not need to change anything.
  The summary quote states that Kana works without `config.json`; the Quick
  start is a need-to-section map, not a set of full templates. Every section
  opens with when to skip it. Examples are the smallest configuration for one
  task; keys that belong together are shown together only when necessary. A
  key's reference table follows its task examples. Legacy names, old voice
  formats, and `kana migrate` live in Upgrading from older builds, not in the
  main setup path. Troubleshooting is last (symptom | fix, quoting Kana's exact
  messages). Short, factual, formal sentences.
- It is written for the person using Kana, not for agents, in a formal register:
  Indonesian is baku with "Anda" (no "kamu", no slang such as "pakai", "kalau",
  "ketemu"), English is professional documentation without contractions. One
  task per heading, and why someone would change a setting. Each language is
  written on its own rather than translated line by line, so wording and
  structure may differ; the facts, section ids and example values stay shared. No
  JSON syntax lessons. Keep its facts in step with `lib/server/user-config.ts`
  and the configuration reference.
- The human page has one bridge to an agent: **Copy for LLM** in the desktop
  sidebar footer and as an icon in the phone header. It copies
  `buildConfigGuideLlm(sources[locale], locale)`, built from the same Markdown
  after removing page-only heading anchors and naming the path fence as text,
  with a short LLM preamble. There is no second LLM document to maintain and no
  raw-text panel on the page.

Presentation:

- It uses Settings' shell: the same sidebar (plain group labels, dotted edge,
  Settings' square nav items). The content is an ordinary document in one column
  (`.kana-doc`) that fills the width to the right, with no max-width, read top to
  bottom, with sections split by dotted rules. No custom layouts (no side-by-side
  steps), no cards or bento boxes; only code blocks (and the config path box)
  have a fill: always dark, in both themes (`.kana-code-surface` redefines the
  theme tokens inside), with square corners, not rounded.
- Headings, bold labels (`**Config file:**`) and table headers are set in a plain
  sans, Inter (`next/font/google` in `app/docs/page.tsx`, exposed as
  `--font-doc-sans`), because the user found them hard to read in the rounded
  face. Running text (paragraphs, quotes, lists, table cells, links) keeps the
  app's M PLUS Rounded 1c, as does the sidebar. Code stays monospace.
- `json` code blocks are coloured by `lib/presentation/json-highlight.ts` (keys
  in Kana's blue, strings, numbers, literals; `--code-*` tokens on
  `.kana-code-surface` in `app/globals.css`), a small tokenizer rather than a
  highlighting library. It only splits the text, so Copy still copies the raw
  example; other languages in the guide stay plain. The chat code card uses the
  wider tokenizer in `lib/presentation/code-highlight.ts` instead.
- Its icons are real icons, Material Symbols Rounded from the subset font in
  `app/fonts` (`MaterialSymbol`), never the drawn two-tone `DuoIcon` glyphs. Add
  a name as `app/fonts/README.md` explains.
- html/body stay `overflow: hidden` for the app, so the guide scrolls inside its
  `main`. Like every page it needs a signed-in session, and `public/sw.js` caches
  only `/` as the offline shell, so `/docs` never replaces it.

## Loading and first-run setup

The "Preparing Kana" loading screen (`kana-app.tsx`, before the workspace is
ready) is always light (`data-theme="light"` on its `main`, since the saved theme
is not applied yet): a plain page with plain text, no pattern and no bubble
behind the label.

First-run setup opens with Kana herself, not a modal: the header and chat step
away, the stage clears (full screen on phones too), the avatar smiles, and her
line types out in a game-style dialogue box (`kana-greeting`) with a tilted name
tag. No blur, no icon, no step bar. The greeting is always English
(`KANA_GREETING` in `lib/ui/copy.ts`, `lang="en"`), whatever the UI language;
the setup screens that follow use the UI language and are numbered in the kicker
text only ("Step 1 of 3").

## The fatal error pages

`app/error.tsx` is the workspace boundary. It keeps the root layout, so the
theme tokens and Kana's vocabulary apply: the headline opens the page without
a mark or a kicker, and its two controls are a `kana-pill-accent` and a
`kana-pill-soft`. It renders outside the workspace stores, so the agent, voice,
avatar, and preference state it would usually report are what failed to load.

`app/global-error.tsx` catches what that boundary cannot and replaces the root
layout, so Next.js applies no global styles to it: no `globals.css`, no tokens,
no web font. It therefore repeats the same page with inline styles whose every
value is a token with the dark theme's own as its fallback, as in
`var(--accent, #599dc6)`, so the page follows the theme when a stylesheet did
reach it and stays legible when none did. It offers no diagnostics copy, because
nothing guarantees the clipboard or the preference record survived the failure it
reports; it shows the failure's reference inline instead.

Both read their copy from the `fatalError` section of `lib/ui/copy.ts`. Their
locale comes from `useUiLocale` and, where a stylesheet applies, their theme from
`useTheme`: a per-mount store hydrated in an effect, which is the one shape
available to a page that has no workspace to read a preference in (`/login`
reads the same record by hand). Neither may import a workspace store, and
neither may report one: what they copy is built by
`lib/diagnostics/safe-diagnostics.ts` and holds the route without its query
values, the redacted thrown value, and the digest, and no other field. A refused
copy shows that snapshot in a selectable block instead of failing silently.

## The chat panel and composer

The chat panel is the plain, square-cornered tray inside the blue `--chat-frame`
border: no texture. With the avatar visible it keeps its original styling: a
responsive dock whose standard width is also its minimum (390–480px),
`--chat-depth` behind the transcript, replies on that same depth instead of a
blue plate, and the blue composer band with white text, white model pill, and
white Send disc. The left
frame is a drag handle: dragging (or ArrowLeft/ArrowRight, Home/End) widens the
dock up to 70% of the screen. While the handle is held the panel may follow the
pointer past that ceiling up to the width the panel has in focus mode (the
viewport minus the rail and insets); releasing springs it back to 70% with the
dock's width transition, while holding at that hard stop for 500ms enters focus
mode and stores `avatarVisible: false`. The drag paints `--kana-chat-width` from the DOM once
per animation frame instead of re-rendering React, so it stays smooth. The
chosen settled width is stored in the local preferences so the next visit opens
at the same size. Past 900px the transcript keeps a centred focus-mode reading
measure while the composer keeps the panel's full width. As the dock grows, the
avatar recentres between the screen's left edge and the panel's left edge. On a desktop, focus mode draws a 2 px frame instead of 4 px, so the
panel reads as one workspace rather than a phone edge; phones keep no frame.
An empty conversation shows one large `--accent` kaomoji, `(๑ > ᴗ < ๑)`, whose
eyes close to `•` for a blink now and then; the eye slots keep one width so the
rest of the line never shifts. The quiet description is hidden text for screen
readers, not a visible greeting.
Only focus mode (the avatar hidden on a desktop, `>=1024px`) changes the
interior: the panel fills the space between the conversation rail and the
window's right edge, while the transcript keeps a centred measure of up to
900 px, on one reading surface (`--surface`), where a reply is unwrapped
Markdown and the reader's own message keeps a quiet `--chat-bubble-user` bubble
on the right. Its composer is one pill row on a `--surface-strong` fill: attach
at the left, the draft, the model as a quiet text control, dictation, and Send
as an accent disc while there is something to send. The bar rests at 380 px
with its placeholder hidden. An empty composer keeps its hint on one line even
in a narrow bar, clipping it at the end instead of wrapping a second line under
the single-row height; a real draft wraps normally. Writing in the text area, a draft, an attachment,
or a live dictation opens it to the transcript's measure (up to 900 px) with a
width transition; focusing the model chooser or the microphone is not enough.
Once all of those are gone the bar keeps its wide state for the configured
delay before it narrows, and its hint stays with it until then. The delay is a
tick-ruler slider in Settings → Experience: one tick per step, a Kana-blue fill,
and a flat grip thumb, from Off to 2 minutes in 5-second steps (30 s by default;
`composerCollapseDelaySeconds` still stores the number of seconds, so an older
custom value keeps its own ruler up to the stored bound). A draft with a line
break turns the bar into a rounded card, with the
words on top and the controls on a row underneath. Image attachments appear as
thumbnail cards above the words, with a borderless image and a remove button
that appears on hover (always visible on touch); other files keep their chips. A rejected file selection reports the file limits in the red error
banner above the composer, not in the small status line. In the blue
avatar-mode composer selected text takes a dark translucent wash, because the
page's blue selection disappears on that band. Phones keep the blue band in
both states; their replies sit on the tray's depth fill rather than a blue
bubble. The model
chooser is a compact square popover above the
pill on desktop and a bottom sheet on phones, with one searchable flat list:
each row is the model over its provider, the model in use carries a check, and
Kana's default carries a small Default pill. The chooser keeps one fixed height
for the whole layout, so filtering, loading, or a short catalog never resizes
it; only the list inside scrolls. Choosing a row applies at once,
with Hermes's cost confirmation when it asks for one. The chooser and the slash
menu are popovers, not bar controls: the focus ink and attachment-chip rules
stop at the bar's own buttons, so the list keeps its own text colours. The
slash menu is a flat command palette: small uppercase group labels, two-line
rows with the command over its description, no repeated command/kind badges,
and a neutral dimmed selected row with no accent fill or accent ink. Kana's own
commands and Hermes's plain commands share one Command group, and the list
scrolls the selected row into view as the user navigates. It is anchored to the
composer's left
edge, never centred. A command typed after blank lines is pulled up to the
first line, so the menu opens as soon as the slash is typed; non-blank text
above the slash keeps the draft untouched. The red alerts sit in the composer
body above the blue tray, and the menu stacks above them, so an open list never
hides an error. A bare command
whose live usage hint marks a required placeholder is not sent: the composer
shakes and shows the command and its usage in the red alert above the bar,
keeping the draft. Settings → AI model adds a
quiet Set as default action for the provider and model currently selected in
the panel; once that pair is Kana's default the same action reads Default and
stays disabled. There is no separate default-model panel, no summary line, and
no description: the button says what it does, and the model dropdown marks the Kana default
with the same Default pill as the composer list. The model actions keep
one minimum width
(and fill the row on phones), so changing labels never reflow the row. The
default is Kana-only and never changes Hermes's own configuration.

Providers are a separate Settings destination, **AI providers**, reached from a
plain text row below a hairline in AI model; the row carries no card fill of its
own. Its sidebar icon is a plug, not a key or cloud. The section is a flat
master-detail list with no cards and no frames: provider rows are separated by
hairlines, each with a name, model count, key state, and a chevron. Key state is
plain text, never a chip or a dot. On hover the
name and chevron take the accent colour and the chevron nudges right; the row
keeps its background, so nothing looks like a card appearing. **New provider**
is a plain accent text action below the list, not another row. Selecting a
provider replaces the list with its detail page: back control, name with **Edit**
beside it, base URL, key state, Direct text where relevant, a **Models** header
with its count at the right, a hairline-separated list of editable model pills,
and **Add model** as the only action below.
Each model ID is an editable pill; changing one reveals a save icon beside it,
and pressing that icon shows the same solid red warning banner as the composer's
error before anything is sent. **Add as new** confirms and adds the changed ID
beside the original, because Hermes cannot rename a model. Add model
asks only for Model ID and context length because the provider already owns the
URL and key. Edit changes the provider's name, base URL, or replacement key
(empty keeps the saved key), lists its current model IDs as read-only pills so
the scope of the change stays visible, and the direct-configuration case asks
for the key again where Hermes cannot read it. New provider asks for the
endpoint and its
first model in a single narrow column, grouped under Connection and Model; the
other provider forms use the same stacked fields. A save returns to the provider
detail, or to the list after creating a provider, with a muted success line and
a refreshed model catalog without switching the active model. The success line
also says whether Kana restarted the managed Hermes so the change applies, or
why it could not (a running reply, a remote Hermes, one Kana did not start, or
one that is stopped); a failed restart is shown in the danger colour. The key
field is a password input and is discarded when its form closes.
While Hermes works, or while the reply's voice is still being generated, the
transcript shows a chat-app typing indicator (`kana-typing`, three hopping dots)
with no visible status text; the status stays screen-reader-only while the dots
and Stop carry the state. Stop is a small icon-and-label pill rather than a
replacement for Send. A message Hermes takes into the
running turn is a right-aligned icon line (`RedirectIcon`) under the user bubble
that opened the turn, never a second bubble. Voice generation has no short time
limit on the client; slow machines keep the indicator up longer.

What each control does, the file limits, dictation, and the model list belong to
`docs/operator/composer.md`; this document keeps only how the composer looks.

## Markdown replies

Hermes replies are Markdown. `ChatMarkdown` renders them through the small reader
in `lib/presentation/markdown.ts` as React elements, never as HTML; links survive
only for http(s) and mailto and open in a new tab, and images become links (Kana
does not load remote pictures into chat). Long words and URLs wrap inside the
message; code blocks and tables scroll inside it. The feed keeps `min-w-0` so one
unbroken string cannot widen it past the panel. In focus mode the transcript is
a centred reading measure, so the panel owns a wheel listener: a wheel over the
side gutters or the composer moves the transcript, while the feed itself and
any nested scroller (a code card, a model list, a long draft) keep their own
wheel. Sending a message returns the transcript to the latest entry, even when
the reader had scrolled up; a reply that arrives while the reader is above does
not pull the view. Settings → Experience carries an **Auto scroll** switch that
pauses that following; the feed keeps only the **Latest** button.

A fenced code block renders as a dark code card (`.kana-chat-code` on the
guide's `.kana-code-surface`) with a monospace language label and a Copy action;
the card scrolls vertically after 22rem and horizontally inside the bubble. A
reply that carries a code card spans the full transcript measure, so a short
sentence above the code never shrinks the card to the width of the text. The
copy control takes the raw code and uses the same select-on-failure fallback as
the message button; the provisional streaming card omits it. Common languages
are coloured by `lib/presentation/code-highlight.ts`, a tokenizer that returns
the source character-for-character and paints it as React spans, never HTML;
HTML/XML, CSS, JavaScript/TypeScript, JSON, Python, shell, SQL, and YAML have
profiles, other named languages use a generic profile, and blocks with no
language or a text language stay plain.

A system row (a Hermes note, such as "Fresh Kana conversation created on a new
Hermes session") is not a card. It is a flat note: a small uppercase label, a
dotted rule stretching to the timestamp, and the note text below. It keeps the
feed's surface and adds no background, border, or corner.

## Activity blocks

A turn's Hermes activity block stays open while the turn runs, even between
tools, unless the reader closes it, and collapses when the reply lands (the feed
remounts it under the reply's key). Finished turns start collapsed. The block
uses a fixed `1.5rem` corner and a `3rem` collapsed summary height, so the
radius is never shrunk by CSS and stays identical when the details open and the
box grows. Its disclosure is Kana's blue plus/minus disc; the title and step
count are plain text, with no count pill or extra status colours. Open rows are
a flat timeline separated by hairlines, each with the tool and detail and its
duration or state.

## Copying a message

`live-chat-feed.tsx` renders one copy control per message row, below the message
and outside its fill, so the fill holds only the message. The control is a round
button with a `size-3` icon (`max-sm:size-3.5`), smaller than the message text,
and it shows a check mark for about 1.6 s after a successful copy with
`aria-live="polite"`. The row places the control at the reply's left edge
(`justify-start pl-1`) and at the reader's own message's right edge
(`justify-end pr-1`), matching the assistant rows being left-aligned
(`self-start`) and user rows right-aligned (`self-end`).

A reply's control stays visible. The reader's own bubble passes `quiet`, and
`.kana-copy-quiet` is hidden by `opacity: 0` inside `@media (hover: hover)` until
that message's `article` is hovered or the button itself is focused — and only
that message, never the ones around it. Because the rule lives in
`@media (hover: hover)`, a device without a pointer (a touch screen) keeps the
button visible at all times.

The text it copies is the words on screen: for an assistant reply the displayed
subtitle text, with any `MEDIA:` links (rendered as players and download buttons)
removed, and for a user row the message text. When the clipboard is unavailable —
a plain-http LAN install has none — the button selects the bubble's text instead
of claiming a copy that did not happen, the same fallback the `/docs` code block
uses.

## Motion

Motion is springy (`--spring`): lift on hover, small press on click, a pop for
check badges. Global reduced-motion rules must keep working.

Switching between the avatar workspace and focus mode is a candy wave wipe,
not a page fade: `wipeAvatarModeChange` (`components/kana/avatar-mode-transition.ts`)
appends a fixed `.kana-wave-wipe` sheet, sweeps it down over the viewport,
writes the preference while the screen is covered, then lets the sheet leave
through the bottom. The sheet is Kana blue with two wave layers behind it, one
white and one light blue, each masked into its own wavy top and bottom, so
both the leading and trailing edges read as several stacked waves; small
four-point sparkles in Kana blue and white ride the exposed bands. Wide
screens swap in one full-width mask with many crests of varied width and
height, so the tighter sweep does not repeat like wallpaper; phones keep the
smooth four/five/three-crest masks.
`app/globals.css` owns the art and the two WAAPI phases own the timing.
Reduced motion changes immediately. A second toggle
during a wipe applies at once, and the running wipe reveals the latest layout
instead of replaying its own older update.

Modals enter with `kana-modal-panel` (fade, 8 px lift, 0.985 scale) while their
dim layer eases in (`kana-modal-backdrop`; the native model chooser animates
its own `::backdrop`). The panel's content follows as one delayed block
(`kana-modal-content-in`). On close the content leaves first, then the panel
and dim layer (`is-closing`); `useModalPresence` keeps a conditionally rendered
modal mounted for `MODAL_EXIT_MS` (320 ms) so that exit can finish, and the
exiting modal is inert and click-through. The panel keeps no transform after
the entrance, because one would become the containing block for the
fixed-position dropdowns inside Settings and the model chooser. Reduced-motion
releases the modal at once.

## Stage patterns

Built-in stage patterns come from `scripts/generate-stage-patterns.py` (edit the
generator, not the SVGs). All use the blue ink. Sakura, sparkle, clouds, and
ribbon sit on a faint blue wash and drift one tile per 90–130 s; sakura, sparkle,
and ribbon add a deeper `-detail` mask layer. Seigaiha stays static. Keep them
calm and simple: they sit behind the avatar.

## Layout

Desktop keeps the workspace hierarchy: a thin header, the avatar as the centred
visual focus of the stage, and the conversation tray on the right with the
transcript and the composer at the bottom. Do not push the avatar into a small
side card merely to expose more panels.

On mobile, conversation history becomes a modal drawer with a backdrop, the
workspace remains one column, and the composer stays reachable at the bottom.
Phones and tablets (below 1024px) are chat-first: the transcript fills the screen
and the live avatar sits in a small call-style tile at the top left, framed on
the face and drawn like a sticker with a thick white stroke. Positioning the
avatar temporarily expands the stage to full screen and fades the chat out in
place (no sideways slide). Do not render desktop side-by-side panels at narrow
widths.

## Accessibility and ergonomics

Keep touch targets accessible, prevent horizontal overflow, respect dynamic
viewport height, and retain keyboard access to the slash-command menu,
dropdowns, and composer. Activity and settings are secondary surfaces. They
should not compete with the avatar and conversation for the primary viewport.
