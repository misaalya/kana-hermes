# Documentation map

This directory is written for agents, not for readers: it carries the big picture, the rules that are easy to break, and the procedures that must be run in order. The code is the truth, and a document that disagrees with the code is a stale document. Read the relevant file here, then open the code it names and decide from the code.

**Read when:** you are about to change Kana and need to know which document covers it.

Nothing in this directory is authoritative about behaviour. Each document opens with a `**Read when:**` line and a `**Truth in code:**` list, which names the files that actually decide the behaviour. Check them before trusting a sentence here, and update the document you proved wrong in the same change that fixes the code.

## Agent

| Document | Covers |
| --- | --- |
| `docs/agent/architecture.md` | The ownership boundary between browser, Kana server, and Hermes; the route and module map; the seam rules that keep Hermes, voice, avatar, storage, and presentation apart. |
| `docs/agent/hermes-contract.md` | The Hermes surface Kana may call: the JSON-RPC allow-list, session lifecycle, the event stream and `MEDIA:` rewriting, slash commands and their dedicated RPCs, and what each kind of Hermes change needs. |
| `docs/agent/response-contract.md` | The Kana response protocol (header, `ja`, `emotion`, `lang`), the persona contract sent with each prompt, the parser's tolerances, and how speech, subtitle, language, and emotion behave on restore. |
| `docs/agent/state-and-storage.md` | Shared workspace state, browser storage, the single server data root and its databases, media links, the backup format, and the request-size limits. |
| `docs/agent/quality-gates.md` | What `npm run quality` runs and proves, which gates need an external service or target hardware, and the rule that a pending result is never reported as a pass. |
| `docs/agent/ui-direction.md` | Kana's product direction: colour and type tokens, the component vocabulary, Settings, the avatar wardrobe, chat and composer behaviour, stage patterns, and the mobile layout. |

## Operator

These documents ship inside the npm package and are linked from the README, so they describe what a user of the installed product can do.

| Document | Covers |
| --- | --- |
| `docs/operator/install.md` | Installing and running Kana (npm package, source checkout, headless server), the first password, and the data directory. |
| `docs/operator/configure.md` | `config.json` and the settings it drives: deployment mode, Hermes executable and port, the TTS providers, and the prompt guardrail. |
| `docs/operator/composer.md` | The composer: sending a message, file attachments and their limits, voice dictation, a turn the guardrail refuses, and the Hermes model picker. |
| `docs/operator/security.md` | The local threat model and the controls that answer it: password login, session custody, origin and host checks, the prompt guardrail's data flow, media delivery, and backup hygiene. |
| `docs/operator/supported-environment.md` | Tested operating systems, runtimes, browsers, and hardware, and the requirements a host must meet. |
| `docs/operator/compatibility.md` | Which Hermes and browser versions Kana supports, and what happens when a dependency moves ahead. |

## Decisions

Numbered records of decisions that were taken and are expensive to reverse. They state the reasoning and the consequences, which the code cannot.

| Document | Covers |
| --- | --- |
| `docs/decisions/0001-process-boundaries.md` | Why Kana is a server-held relay in front of `hermes serve` rather than a second agent or a messaging platform. |
| `docs/decisions/0002-tts-delivery.md` | Why the local Irodori engine is the default speech provider, and why sentence-split delivery stays opt-in. |
| `docs/decisions/0003-data-root.md` | Why the data root is `~/.kana`, and how an earlier install is moved into it on the next start. |
| `docs/decisions/0004-migrate-command.md` | Why `kana migrate` exists, why an operator-set root is never moved automatically, and what the command guarantees about a copy. |
| `docs/decisions/0005-prompt-guardrail.md` | Why the prompt guardrail screens a turn in the relay with a typed judgment instead of an LLM, why its rules live in a file Kana cannot write, and why an unchecked prompt is refused by default. |

## Evidence

Local evidence that a real-world claim was observed. These documents describe gates whose data lives outside the repository, in ignored directories on the machine that ran them.

| Document | Covers |
| --- | --- |
| `docs/evidence/dogfood.md` | The field-validation journal: how a day of real use is recorded, what a matrix row means, and why the gate is not a pass yet. |
| `docs/evidence/hermes-restart.md` | The restart evidence: the isolated automated harness for the idle case and the hand-written matrix for a restart during a turn or protected input. |
| `docs/evidence/release-checklist.md` | Releasing Kana: the version bump, the checks that must pass, the build-outside-the-home rule, and publishing with the owner's interactive second factor. |

## House style

Every document in this directory follows the same shape, so an agent can find what it needs without reading the file.

- English, formal and plain. No emoji, no marketing tone, no contractions in the operator documents.
- `# Sentence-case title` and `## Sentence-case headings`; only the first word and proper nouns are capitalised.
- One or two sentences of summary, then the mandatory `**Read when:**` line and the `**Truth in code:**` list.
- Prose paragraphs, with a table or a short list only where it fits. Procedures and command output get a fenced code block.
- File names are lowercase kebab: `state-and-storage.md`, not `StateAndStorage.md`.
- A path, class, token, or command cited in a document must exist now. Verify it in the checkout before writing it, and never document a command that `package.json` does not define.