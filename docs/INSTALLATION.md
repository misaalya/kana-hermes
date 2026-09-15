# Install and deploy Kana

Kana has one web application and two distribution paths. Installation method
and server location are independent choices:

| Use | Install | Run | Browser |
| --- | --- | --- | --- |
| Personal computer | `npm install -g kana-alya` | `kana` | Opens on the same computer |
| VPS, prebuilt package | `npm install -g kana-alya` on the VPS | `kana serve` under systemd | Open the VPS HTTPS domain |
| VPS or custom build from source | `npm ci` then `npm run package:local` | Standalone `server.js` under systemd | Open the server HTTPS domain |
| Development | `npm ci` | `npm run dev` | Local development only |

An npm installation on your laptop does not deploy anything to a VPS. Install
on the VPS, or build a standalone artifact and transfer it there. A VPS does
not require a global npm installation when using the source/standalone path.

## Prebuilt installation

```bash
npm install -g kana-alya
kana
```

The first start asks you to create the access password in the terminal; Kana
has no default password. Change it later with `kana password` or in Settings.

The package includes the built web runtime. It does not build the frontend,
install Hermes, download a speech model, or create user-owned config during
npm installation. The account running Kana owns its config and data.

For a server, run under the account that owns Hermes and the Kana data root:

```bash
KANA_DATA_DIR=/var/lib/kana kana config
KANA_DATA_DIR=/var/lib/kana kana password
KANA_DATA_DIR=/var/lib/kana kana serve --port 3000
```

A non-interactive `kana serve` (for example under systemd) refuses to start
until a password exists. Run `kana password` once as the service account, or
pipe it for automation: `printf '%s\n' "$PASSWORD" | kana password --stdin`.

`kana serve` runs in the foreground, forces deployment mode, and never opens a
browser. Its default bind address remains `127.0.0.1` for an HTTPS reverse
proxy on the same host. Use `--host 0.0.0.0` or `--host ::` explicitly for a
container or private network that needs a non-loopback listener. `kana` retains
its local browser-opening behavior. `--no-open` is still supported.

For systemd, use the [service and Nginx examples](SUPPORTED_ENVIRONMENT.md#vps-deploy-checklist).
For an npm installation replace the example's `ExecStart` with the absolute
path reported by `command -v kana`, followed by `serve --port 3000`. Ensure
Node.js is on the service's PATH, especially with a per-user Node manager.
Use one Kana server process per data root: the shared Hermes socket, request
cancellation registry and local model supervisor live in that process. Do not
use PM2 cluster mode or multiple replicas against the same directory.

To update, stop the service, install the selected published version on the
server, and restart the service. Keep `KANA_DATA_DIR` unchanged. The work in a
source checkout is available through npm only after a new release is published.

## Build your own deployment

```bash
git clone https://github.com/misaalya/kana-hermes.git
cd kana-hermes
npm ci
npm run package:local
```

Deploy the **entire** `.next/standalone` directory, including hidden `.next`
assets. On the server, use an absolute data root outside that directory:

```bash
KANA_DATA_DIR=/var/lib/kana node /opt/kana/bin/kana.mjs password
KANA_DATA_DIR=/var/lib/kana node /opt/kana/bin/kana.mjs serve --port 3000
```

This assumes the contents of `.next/standalone` were copied to `/opt/kana`;
`package:local` places the launcher (`bin/`, `config/`, `shared/`) next to
`server.js`.
You do not need `npm install -g kana-alya` on this path. Do not deploy `next dev`.
The same server config, authentication, relay and TTS implementation run in
both distribution paths. Build for the target platform; the current npm
artifact targets Linux x64/glibc and Node.js 22.13+.

## Where things run

Hermes and the optional local voice engine run on the **Kana server machine**.
Browser audio playback and Live2D run on the device opening the page.
A VPS installation cannot discover Hermes installed only on your laptop.
Install and configure the user's unmodified Hermes on the VPS and run Kana
under the same account: Linux only lets that user read a running gateway's
session token. Existing Hermes installations remain independently managed.

`tts.provider` in server `config.json` chooses the local Irodori engine or an
external speech API. Both work with either installation method. External TTS
downloads nothing; the local engine is downloaded only from Settings → Voice
and needs Linux x86-64 with an AVX2 CPU, about 3.9 GB of disk, and 2 GB of free
RAM while speaking. No automatic fallback sends local speech text to an external
provider. See [configuration](CONFIGURATION.md).

Server config, password and voice references belong to `KANA_DATA_DIR`.
Browser preferences such as voice on/off and imported avatar packages belong
to that browser. Configure TLS, proxy timeouts and persistent storage for VPS;
a local laptop normally needs only the loopback listener and default data root.

## Repository and npm package boundary

This follows the distribution pattern used by
[9router's private source app](https://github.com/decolua/9router/blob/master/package.json)
and [its separate CLI package](https://github.com/decolua/9router/blob/master/cli/package.json):

- Root `package.json`: private `kana-app`, source dependencies, tests and build.
- `cli/package.json`: public `kana-alya` manifest; commands `kana` and `kana-alya`.
- `bin/`, `config/`, `shared/`: authoritative launcher, starter config, and the
  plain-ESM modules (data root, password hashing, appstate schema, Hermes
  discovery) shared by the launcher and the server.
- `npm run package:npm`: builds the app, assembles generated CLI files and
  inspects the npm artifact. `npm pack ./cli` also builds before packing.
- `npm run publish:cli`: guarded publication of the CLI package. It runs lint,
  typecheck, and unit tests, and refuses a dirty working tree. Keep the app and
  CLI versions equal. Never publish the private source package. Service and
  asset files are packed from `git ls-files`, so untracked local files are
  never shipped.

The separation is about delivery and launch behavior. It does not create a
second app, a second configuration system, or a second Hermes agent.
