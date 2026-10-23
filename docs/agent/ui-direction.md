# UI direction

Kana uses a cozy game-menu style that follows the Clara dressing-room viewer
(itself modelled on Nintendo life-sim menus such as Animal Crossing and
Tomodachi Life), in Kana's own colours. It is soft, round, and friendly, but it
stays a calm workspace rather than an ornamental dashboard. This is a product
direction, not a temporary theme.

**Read when:** you are changing any component, `app/globals.css`, the composer, Settings, the avatar wardrobe, the chat feed, a stage pattern, or the fatal error pages.

**Truth in code:** `app/globals.css`, `app/error.tsx`, `app/global-error.tsx`, `components/kana/chat-composer.tsx`, `components/kana/live-chat-feed.tsx`, `components/kana/settings-avatar-cards.tsx`, `components/kana/kana-select.tsx`, `components/kana/config-guide.tsx`, `app/docs/page.tsx`, `lib/ui/copy.ts`, `lib/presentation/markdown.ts`, `lib/presentation/json-highlight.ts`, `scripts/generate-stage-patterns.py`

## Colours

Colours are Kana's originals, defined in `app/globals.css` and exposed to
Tailwind through `@theme inline`: the white/grey neutrals (light `#f4f4f2` /
`#ffffff`, dark `#1c1c1c` / `#242424`), the brand blue `--accent` `#599dc6`
with `--accent-hover`, `--accent-strong`, `--on-accent`, `--chat-frame`,
`--chat-bubble`, and the stage-pattern inks. Do not tint the neutrals or add new
shades of blue; style through the tokens.

## Flat shapes, no shadows

No shadows of any kind: no drop shadows, no flat "ledge" shadows, no glow.
Pieces are flat colour shapes separated by fill, radius, and spacing.

## Typeface

One typeface, M PLUS Rounded 1c (`next/font/google`, variable
`--font-kana-sans`, weights 400–800), for Latin UI text and Japanese subtitles
alike. Headings and pills use the heavy weights (700–800).

## Component vocabulary

Components copy Clara's vocabulary (shared classes in `app/globals.css`):

- Header actions are a blue pill tray (`kana-bar`) of round tabs. An open tab
  turns into the white disc, and a label bubble (`kana-tip`) appears under a tab
  while it is pointed at or open.
- The conversation title is a blue name chip.
- Buttons are heavy pills (`kana-pill`, with `kana-pill-accent` striped blue for
  primary actions and `kana-pill-soft` for secondary ones) that hop up on hover.
- Choices are rounded cards (`kana-choice`). The selection is a blue ring plus a
  round check badge (`kana-check`) on the corner.
- Settings → Avatar is Clara's wardrobe (`kana-wardrobe`,
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
included) are square too. Controls inside a modal keep their rounded shapes, and
the greeting dialogue box (`kana-greeting`) is not a modal.

## Conversation history

Conversation history has no "Recent" label. A dotted stroke like the Settings
sidebar edge, inset to the search field's edges with room above and below,
separates the search from the list. Only a search result count gets a label
bubble.

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
ticker, while the room's pattern stays as the wallpaper. The conversation
becomes a centred 720 px column (`is-sole`) instead of an unreadable full-width
wall, the phone tile and the hide-chat tab disappear, and the "Scale" header tab
is not rendered. Kana's first-run greeting always keeps the stage, because it
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
- Its delivery follows the Pollinations API docs
  (https://gen.pollinations.ai/docs): a one-sentence summary quote under the
  title, then bold-label key facts (**Config file:**, **Open it:**); a Quick
  start of short headings each followed straight by code; one section per config
  block that opens with one sentence, lists its keys in a Markdown table (Key |
  Default or Required | Description) and uses `> **Note:**` callouts;
  Troubleshooting last (symptom | fix, quoting Kana's exact messages). Short,
  factual, formal sentences.
- It is written for the person using Kana, not for agents, in a formal register:
  Indonesian is baku with "Anda" (no "kamu", no slang such as "pakai", "kalau",
  "ketemu"), English is professional documentation without contractions. One
  task per heading, and why someone would change a setting. Each language is
  written on its own rather than translated line by line, so wording and
  structure may differ; the facts, section ids and example values stay shared. No
  JSON syntax lessons. Keep its facts in step with `lib/server/user-config.ts`
  and the configuration reference.

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
  example; other languages stay plain.
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

The chat panel is the plain tray inside the blue `--chat-frame` border: no
texture. The composer stays the blue band with a transparent text field and white
text; its model chooser is a white pill and Send becomes a white disc when there
is something to send. While Hermes works, or while the reply's voice is still
being generated, the transcript shows a chat-app typing bubble (`kana-typing`,
three hopping dots) with the status beside it, and Stop is a small icon-and-label
pill next to that status rather than a replacement for Send. A message Hermes
takes into the running turn is a right-aligned icon line (`RedirectIcon`) under
the user bubble that opened the turn, never a second bubble. Voice generation has
no short time limit on the client; slow machines keep the bubble up longer.

What each control does, the file limits, dictation, and the model list belong to
`docs/operator/composer.md`; this document keeps only how the composer looks.

## Markdown replies

Hermes replies are Markdown. `ChatMarkdown` renders them through the small reader
in `lib/presentation/markdown.ts` as React elements, never as HTML; links survive
only for http(s) and mailto and open in a new tab, and images become links (Kana
does not load remote pictures into chat). Long words and URLs wrap inside the
bubble; code blocks and tables scroll inside it. The feed keeps `min-w-0` so one
unbroken string cannot widen it past the panel.

## Activity blocks

A turn's Hermes activity block stays open while the turn runs, even between
tools, unless the reader closes it, and collapses when the reply lands (the feed
remounts it under the reply's key). Finished turns start collapsed.

## Copying a message

`live-chat-feed.tsx` renders one copy control per message row, below the bubble
and under its fill, so the bubble's fill holds only the message. The control is a
round button with a `size-3` icon (`max-sm:size-3.5`), smaller than the bubble's
text, and it shows a check mark for about 1.6 s after a successful copy with
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
