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

The package includes the built web runtime. It does not build the frontend,
install Hermes, download a speech model, or create user-owned config during
npm installation. The account running Kana owns its config and data.

For a server, run under the account that owns Hermes and the Kana data root:

```bash
KANA_DATA_DIR=/var/lib/kana kana config
KANA_DATA_DIR=/var/lib/kana kana serve --port 3000
```

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
KANA_DATA_DIR=/var/lib/kana \
KANA_DEPLOYMENT_MODE=deployment \
HOSTNAME=127.0.0.1 PORT=3000 \
node /opt/kana/server.js
```

This assumes the contents of `.next/standalone` were copied to `/opt/kana`.
You do not need `npm install -g kana-alya` on this path. Do not deploy `next dev`.
The same server config, authentication, relay and TTS implementation run in
both distribution paths. Build for the target platform; the current npm
artifact targets Linux x64/glibc and Node.js 22.13+.

## Where things run

Hermes and an optional local Qwen model run on the **Kana server machine**.
Browser audio playback and Live2D run on the device opening the page.
A VPS installation cannot discover Hermes installed only on your laptop.
Install and configure the user's unmodified Hermes on the VPS under the
service account. Existing Hermes installations remain independently managed.

`tts.provider` in server `config.json` chooses local Qwen or an external speech
API. Both work with either installation method. External TTS needs no local
Qwen environment; local Qwen needs `uv`, model storage, and sufficient server
RAM/CPU or GPU. No automatic fallback sends local speech text to an external
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
- `bin/` and `config/`: authoritative launcher and starter config sources.
- `npm run package:npm`: builds the app, assembles generated CLI files and
  inspects the npm artifact. `npm pack ./cli` also builds before packing.
- `npm run publish:cli`: guarded publication of the CLI package. Keep the app
  and CLI versions equal. Never publish the private source package.

The separation is about delivery and launch behavior. It does not create a
second app, a second configuration system, or a second Hermes agent.
