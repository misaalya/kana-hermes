# ADR-0004: A requested move of a managed data root

Status: accepted, 2026-10-19; adds the one path by which an operator-set root moves.

**Read when:** you are changing `kana migrate`, or anything that decides where an upgrade finds Kana's data.
**Truth in code:** `shared/data-dir.mjs`, `bin/lib/commands.mjs`, `bin/kana.mjs`, `bin/lib/ui.mjs`

ADR-0003 made the automatic migration narrow on purpose: it runs only when Kana
resolved its own default root, and an operator-set `KANA_DATA_DIR` is never
touched, because moving user data has no undo, and because a path an operator
named may be a mounted volume, another account's home, or the root a service is
reading at this moment. That rule left one case unanswered: an operator who wants
a managed deployment to join the standard `~/.kana` layout had no way to ask for
the move.

`kana migrate` is that request, and the request is what makes the move correct:
the operator names the root, reads the plan, and agrees to it. It refuses to run
without an interactive terminal or an explicit `--yes`, so data never moves
because of an unnoticed environment variable or a stray line in a script.

The command never edits a systemd unit or any other file Kana does not own. It
moves the data and states the change the operator has to make — set
`KANA_DATA_DIR` to the new root, or remove it — because a service that still
names the old path would start against an empty directory.

By default the command copies and keeps the source. It writes a file, verifies
that the bytes it wrote equal the bytes it read, recreates a directory with its
own mode, and takes a WAL database and its journal files together, exactly as the
automatic path does. A copy has an undo: the source is still there until a person
deletes it. `--delete-source` moves instead, using a rename inside one
filesystem, so entries are never half-taken. A failed copy takes back what it
wrote, reports the entry, and leaves the source whole for the next attempt.

Recognition stays strict. A directory is a candidate only when it holds
`appstate.db`, `activities.db`, `jwt-secret`, `voices/`, or `irodori/`, and
`--force` is the one way to move a directory that holds none of them. The
launcher prints the entry names, the bytes, and a reason for everything it passed
over, so an operator reads the same rules the move then applies: the plan and the
move call one selection, and cannot disagree about what belongs to a Kana root.

The rejected alternative was to migrate a `KANA_DATA_DIR` root automatically when
a release changes the layout again. It would move data while the configured path
still pointed elsewhere, and it would take the decision away from the operator
who set that path in order to make it.
