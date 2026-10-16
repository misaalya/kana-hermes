# ADR-0003: Keep the data root in a home dot directory

Status: accepted, 2026-10-17; replaces the XDG data directory of the 0.4.x line.

**Read when:** you are changing where Kana stores its data, or how an upgrade finds it.
**Truth in code:** `shared/data-dir.mjs`, `lib/server/data-dir.ts`,
`bin/lib/context.mjs`, `bin/lib/password.mjs`.

Kana keeps every server file under one root. `KANA_DATA_DIR`, when set, is that
root and is used as it is. Otherwise the root is `~/.kana`, beside the other
agent tools a user installs (`~/.hermes`, `~/.opencode`), so a reader who knows
those tools finds Kana's folder the same way. `kana doctor` names the resolved
root, and `kana --help` states the rule.

The 0.4.x line resolved `$XDG_DATA_HOME/kana` first and `~/.local/share/kana`
as the final default. XDG is the Linux standard for application data, and its
reason for existing still holds: it keeps a home directory free of one dot
directory per tool, and it splits data from configuration. It lost here to the
sibling-tool convention on discoverability. A person who works with Hermes looks
for Kana beside Hermes, and a path under `~/.local/share` read as a location the
user never chose. One root also stays the whole recipe for a backup, a machine
move, or a systemd unit.

An upgrade must not strand data. The first start of a release after this one
moves what an earlier root holds into the resolved root, one entry at a time:
`config.json`, `auth.json`, `jwt-secret`, `appstate.db`, `activities.db`, the
`voices/` library, and an installed engine under `irodori/`. A file already in
the target always wins, the newest copy wins when two earlier roots both hold a
name, a WAL database moves together with its journal files, and a directory
moves whole. The move runs in the `kana` launcher before any command and in the
server on first store access, once per process. It never throws: a legacy root
another account owns must not block a start, and an entry that could not be
moved stays where it is for the next start.

The migration is deliberately narrow, because moving user data has no undo. It
runs only when Kana resolved its own default root: `KANA_DATA_DIR` is an
operator's managed location, so nothing is ever moved into or out of it, and a
test or capture run that points the root at a temporary directory cannot touch
the developer's own install. A directory counts as an earlier root only when it
holds something Kana wrote, so a project folder that happens to be named `data`
is left alone. Recognition needs a name only Kana writes — `appstate.db`,
`activities.db`, `jwt-secret`, `voices/`, or `irodori/`. `config.json` and
`auth.json` deliberately do not qualify a directory, because an unrelated
project folder often holds a file with one of those names, and taking one for
Kana's root would move a stranger's files.

That trade-off is accepted in the other direction too. An install that holds
nothing but `config.json` — someone who ran `kana config`, never set a password,
and never started the server, which is the state before `jwt-secret` and
`appstate.db` appear — is not moved, and Kana writes a fresh default
`config.json` into the resolved root instead. The password survives that case
regardless: `auth.json` is still adopted per file by the server, and that path
is not gated by recognition. Keys, a WAL database that is open in a running
older server, and a root drained only in part are all acceptable outcomes, and
the next start finishes the move — except for a database whose remaining journal
is already claimed by the target, which stays where it is and is inert.

The rejected alternative was a `postinstall` script that migrates during
`npm install -g kana-alya`. It would move files while no Kana process expects
it, it would run as whichever account owns the global prefix (often root, whose
home is not the user's), and it would not cover a tarball, a source checkout, or
a systemd restart. Doing it on the next start covers every install path with the
same code, and the launcher prints each moved entry.
