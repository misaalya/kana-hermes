# ADR-0005: A prompt guardrail the owner writes

Status: accepted, 2026-10-19; adds an optional, server-side screen on the text Kana forwards to Hermes.

**Read when:** you are changing the prompt guardrail, the relay's handling of a refused turn, or the `guardrails` block of `config.json`.
**Truth in code:** `lib/guardrails/policy.ts`, `lib/guardrails/prompt.ts`, `lib/guardrails/jev.ts`, `lib/guardrails/screen.ts`, `lib/guardrails/protocol.ts`, `app/api/hermes/rpc/route.ts`, `lib/services/send-message.ts`

Every path into Hermes runs through one server-side relay, and the operator who
runs Kana may want to refuse some requests before the agent ever sees them. A
system prompt puts that rule in the place a jailbreak talks its way past, and a
second language model in front of the first costs a full turn's latency and can
be talked past too. TypeSafe's Jev answers a typed yes/no question with a
probability instead of text, so one `Noul` question gives Kana a number it can
threshold in its own code. Jev is not a language model: it produces no prose, and
Kana never asks it to.

The owner writes rules and nothing else. A rule is one statement in the owner's
own words of what Kana must not do, and Kana builds the request around them
(`lib/guardrails/prompt.ts`): the rules travel as the question's data, the
message travels as the state, and the question is whether the message asks for,
attempts, or enables anything the rules forbid. The owner writes no question, no
question id, no criteria, and no per-rule threshold, because the judgment is
Kana's to phrase and the alternative asks the owner to learn a protocol to state
a rule they can already state in a sentence. Jev is told what it is screening
for: a message typed into Kana, whose agent can read and write files, run
commands, and use tools on the owner's own computer.

The shape was measured rather than assumed, against 34 messages — 17 violations
and 17 near-misses, in English and Indonesian, including a violation framed as a
novel, one framed as a security audit, and one claiming a new instruction from
the developer. One question over the rules as data at the 0.7 threshold refused
every violation and no near-miss at 0.5, 0.7, and 0.9 across the first 20; on the
14 harder cases it refused every violation at 0.9 and all but one at 0.5 and
0.7, where the lone disagreement asked for a safe way to delete old files, which
is a defensible refusal rather than a clear mistake. One question per rule
matched that at 0.5 and 0.7 and cost about 60% more input tokens (828 against
506-525 on average), and it needs no less authoring from the owner. A question
built by pasting each rule into the instruction scored 0.09 to 0.45 on
unambiguous violations, because a prohibition reads as nonsense inside a question
and Jev answers the literal words in front of it. The harness was a scratch
script against `jev-latest` on 2026-10-19 and is not committed, since it needs a
paid key and the open network; the numbers decided the shape, and they are not a
gate.

The screen sits in `POST /api/hermes/rpc`, the single choke point every prompt
uses. It reads the user's own words — the same `unwrapKanaUserPrompt` the
transcript restore uses — and refuses before the request reaches the Hermes
bridge, so a refused turn is never forwarded, never stored in the Hermes
transcript, and never answered by the model. The TypeSafe key lives in
`config.json` and stays in the server process; `GET /api/kana/config` reports
whether the guardrail is on and how many rules it would send, never the key or a
rule's text. Adding a rule adds no request: every rule is data inside the one
question, so a message costs one screening call however long the list is.

The rules are the owner's and Kana cannot edit them. Kana has no writer for
`config.json` at all — the file is created once, owner-only, and never replaced —
so no route, setting, or browser request can change a rule, and a settings screen
cannot be used to disable its own guardrail. The `guardrails` block is read by
its own module rather than by `parseKanaUserConfigFile`, so a broken rule cannot
take down the speech configuration and a broken speech block cannot silently
disable the guardrail. Because `config.json` is read on each turn, a rule change
applies to the next message without a restart.

That guarantee is against Kana, not against the agent. When Kana and Hermes run
as the same user, as the default installation does, the data root is the agent's
to write as much as the owner's, and nothing in Kana can stop a turn — a shell
command, a subagent, or an MCP tool — from replacing the file. Emptying
`guardrails.rules` is enough on its own, since an empty list means the owner is
not using the guardrail and the layer is off. Kana refuses to design around this
inside its own process: it cannot both watch the file and be trusted to defend
it, and a check that only reads the guardrail's own configuration can be turned
off by the thing it is meant to check. The defence is the operating system's
immutable flag on the file (`operator/security.md`), which the owner sets and
clears, and which no process on the machine can write through.

An empty `apiKey` turns the layer off completely: no request is made, nothing is
spent, and Kana behaves exactly as it did before this decision. A key with no
rules is the same. The key is read leniently on purpose — absent, empty, or
blank all mean "off" — because a new `config.json` ships rules and an empty key,
and a blank key that failed the parse would turn a fresh install into one that
refuses every turn. The rules ship as starters the owner can keep or replace;
they are inert until a key exists.

When the guardrail cannot run — TypeSafe is unreachable, rate limits, rejects the
key, returns an answer Kana cannot read, or does not answer the question — the
default is to refuse rather than forward an unchecked prompt (`whenUnavailable:
"block"`), and the refusal says which of those happened. Failing open would make
an outage indistinguishable from a pass. An operator who prefers availability
over that guarantee sets `"allow"`, and that choice is read from the raw block
even while a rule is invalid, so a broken rule never removes the way out.

A refusal is Kana's own fixed wording, not a model reply. Hermes never saw the
message, so no persona reply exists to show, and inventing one would claim a
judgment the model never made. The wording names no rule, because one question
returns one number and attributing the refusal would cost a second judgment;
`Choice` over the rules in the same request is the way to add that later without
a second call. The user's message stays in the conversation and Kana's line sits
under it; because Hermes never stored the turn, both survive a reload as local
rows.

The screen covers the text a turn starts with: a chat message, a slash command
with its arguments, and `/steer`. It does not screen an answer given in the
middle of a turn — an approval, or an answer to a question from Hermes — because
refusing one would strand a turn Hermes has already started, and Kana has no
protocol for aborting it. It is an intent filter, not a sandbox: it reads the
text of a turn and cannot stop Hermes from reaching the same file by another
route, nor read the contents of an attached file.

Two consequences the operator accepts by setting a key. The text of every
screened turn is sent to TypeSafe's API, which is a third party, and each turn
costs one request. And Jev is trained mostly on English, so rules in English over
states in another language are the arrangement it was built for; the same prompt
may score differently in a language the model saw less of during training.

The rejected alternatives were a browser-side check, which a modified page can
skip and which would put the key in the browser; a second language model, which
costs a turn and can be argued with; embedding the rules in the persona
contract, which puts the owner's rules inside the same message a jailbreak
targets; and a per-rule authoring surface of questions, ids, criteria, and
thresholds, which asks the owner to phrase Kana's judgments and spent more tokens
for the same measured accuracy.