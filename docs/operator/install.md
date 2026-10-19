# Install Kana

Kana ships as one npm package and one source checkout, and both run the same
web server. This page covers installation, the first start, and the data root.

**Read when:** you are installing Kana on a computer or a server, or starting it for the first time.
**Truth in code:** `bin/kana.mjs`, `bin/lib/server.mjs`, `bin/lib/password.mjs`, `bin/lib/commands.mjs`, `shared/data-dir.mjs`, `scripts/package-standalone.mjs`

## Install from npm

Kana needs Node.js 22.13 or newer. The published artifact targets Linux x86-64
with glibc; on another host, build from source.

```bash
npm install -g kana-alya
kana
```

The package has no runtime dependencies: it bundles the built Next.js runtime,
the launcher, and the starter configuration, and never installs Hermes or a voice model.

`kana`, or the explicitly spelled `kana start`, starts the server on
`127.0.0.1:3000` and opens the default browser at it. `kana serve` runs the same
server in the foreground without a browser, for a VPS or a systemd service, and
forces deployment mode for the life of that process.

| Command | What it does |
| --- | --- |
| `kana`, `kana start` | Starts the web server on this computer and opens the browser. |
| `kana serve` | Runs headless in the foreground with deployment mode; never opens a browser. |
| `kana password` | Creates or changes the access password, on an interactive terminal or from `--stdin`. |
| `kana config` | Creates `config.json` when missing and opens it in `$VISUAL` or `$EDITOR`, otherwise prints its path. |
| `kana setup` | Explains the optional local voice download and prints its size. |
| `kana migrate` | Copies or moves a `KANA_DATA_DIR` root into the default `~/.kana` root, showing every entry and verifying what it writes. |
| `kana doctor` | Reports Node.js, the web runtime, the password, the config file, Hermes, running Hermes gateways, voice, and the resolved data paths. |

`--port` (default `3000`, then `$KANA_PORT`, then `$PORT`, and 1024–65535) sets
the web port. `--host` sets the bind address of `kana serve`, whose default is
`127.0.0.1`; a plain `kana` always listens on this computer only. `--no-open` skips the browser.

Kana has no default password. On the first `kana` or `kana serve` start in a
terminal, the launcher creates `config.json` and the session secret in the data
root, then asks for the password used to sign in: 8 to 256 characters, without
leading or trailing whitespace. A start that cannot prompt, such as a systemd
service, refuses to run until the password exists:

```bash
kana password
printf '%s\n' "$PASSWORD" | kana password --stdin
```

Change the password later from Settings → Privacy, which asks for the current
one, or with `kana password`, which signs out every open browser. Until a
password exists, the login page shows the one command that fits the running
installation.

## The data root

Kana keeps all server-side state in one directory: `KANA_DATA_DIR` when it is
set (absolute, required), otherwise `~/.kana`. A production server without a
resolvable home directory fails loudly instead of using the current working
directory. On the first start after an upgrade, files from earlier layouts
(`$XDG_DATA_HOME/kana`, `~/.local/share/kana`, `./data`) are moved into the
resolved directory; an operator-set `KANA_DATA_DIR` is never touched.

| Path | Contents |
| --- | --- |
| `config.json` | The optional advanced configuration (`configure.md`), mode `0600`. |
| `jwt-secret` | The session-signing secret, mode `0600`. |
| `appstate.db` | SQLite: the password hash, install-level flags, and the voice library. |
| `activities.db` | SQLite: the per-turn Hermes tool activity log. |
| `voices/` | Reference WAV files uploaded for voice cloning. |
| `irodori/` | The local voice engine, its shared assets, and the model, when downloaded. |

Run exactly one Kana server process per data root. The Hermes socket, request
cancellation registry, and local engine supervisor live in that process, and are
not shared by clustered workers or replicas. Configure TLS, proxy timeouts, and
persistent storage for a server deployment (`supported-environment.md`); a
laptop normally needs only the default root.

### Moving a managed root to the default

A start never moves a root that `KANA_DATA_DIR` names. `kana migrate` is the one
command that moves one, and only when asked. Stop the service that runs Kana,
then read the plan and apply it with the same `KANA_DATA_DIR` the unit sets, or
name the root with `--from`:

```bash
kana migrate --dry-run   # reads the plan
kana migrate             # copies $KANA_DATA_DIR into ~/.kana
```

It lists every entry with its size, copies each one, and verifies that the bytes
it wrote equal the bytes it read; the source stays where it was, so starting the
service again with the same root undoes the copy. `--delete-source` moves the
entries instead of copying them, `--yes` confirms without a prompt, and a
directory that holds nothing Kana writes is refused unless `--force` is given.

Kana never edits a systemd unit. Point `KANA_DATA_DIR` at the new root, or remove
it so the service uses the `~/.kana` of the user that runs it, then start the
service again and read the root Kana reports:

```bash
kana doctor              # prints the data root this installation uses
```

## Install from a source checkout

```bash
git clone https://github.com/misaalya/kana-hermes.git
cd kana-hermes
npm install
npm run password      # first: create the access password
npm run dev           # next dev on 127.0.0.1:3000
```

`npm run dev` starts Next.js directly, so the launcher's first-run prompt does
not run and a password must exist first. The other scripts are the same commands
through the launcher: `npm run start:local` (`kana`), `npm run serve`
(`kana serve`), `npm run password`, and `npm run config`. A checkout that has not
been built yet says so and asks for `npm run package:local`.

`npm run build` produces the production Next.js build in `.next/`, and
`npm run package:local` builds and assembles a deployable `.next/standalone`
holding `server.js`, `.next/static`, `public/`, `assets/voices/`, and the
launcher (`bin/`, `config/`, `shared/`, `docs/`).

The root `package.json` is the private source app `kana-app`; `cli/package.json`
is the public `kana-alya` package, and both versions stay equal. Only the CLI
package is published, after `npm run package:npm` reassembles the generated `cli/` payload.

## Deploy the standalone build

Deploy the entire `.next/standalone` directory, including the hidden `.next`
assets, and keep the data root outside it. The launcher sits next to
`server.js`, so a deployment at `/opt/kana` runs with:

```bash
KANA_DATA_DIR=/var/lib/kana node /opt/kana/bin/kana.mjs password
KANA_DATA_DIR=/var/lib/kana node /opt/kana/bin/kana.mjs serve --port 3000
```

The service and Nginx examples, the reverse-proxy headers, and the platform
baseline are in `supported-environment.md`. To update either distribution path,
stop the service, install the new version, and start it with the same data root.

## Where Kana and Hermes run

Hermes and the optional local voice engine run on the machine hosting Kana;
browser audio playback and Live2D run on the device opening the page. Kana must
run as the user who owns Hermes: Linux exposes a running gateway's token only to
its own user.

## Next steps

- `configure.md` for every `config.json` key, its default, and how to apply a change.
- `supported-environment.md` for the tested platform, VPS checklist, and known limits.
- `security.md` for the threat model, password storage, and reverse-proxy rules.