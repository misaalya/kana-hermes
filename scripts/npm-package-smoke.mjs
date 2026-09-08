import { spawn, spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "kana-npm-smoke-"));
const packRoot = path.join(temporary, "pack");
const installRoot = path.join(temporary, "install");
const home = path.join(temporary, "home");
const fakeBin = path.join(home, "custom-tools", "bin");
const fakeHermes = path.join(fakeBin, "hermes");
const fakeHermesPidFile = path.join(temporary, "fake-hermes.pid");

try {
  await mkdir(packRoot, { recursive: true });
  const packed = run("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packRoot,
  ], path.join(root, "cli"));
  const packResult = JSON.parse(packed.stdout)[0];
  if (!packResult?.filename || !Array.isArray(packResult.files)) {
    throw new Error("npm pack did not return a file manifest.");
  }

  const paths = new Set(packResult.files.map((entry) => entry.path));
  for (const required of [
    "bin/kana.mjs",
    "CHANGELOG.md",
    "PLAN.md",
    ".npm-package/runtime/server.js",
    ".npm-package/runtime/.next/BUILD_ID",
    ".npm-package/runtime/assets/voices/kana-default.wav",
    ".npm-package/runtime/public/backgrounds/kana-room.png",
    ".npm-package/runtime/services/qwen3-tts/pyproject.toml",
  ]) {
    if (!paths.has(required)) throw new Error(`npm package is missing ${required}`);
  }
  const forbidden = [...paths].find((entry) =>
    /^\.npm-package\/runtime\/(?:app|components)\//.test(entry) ||
    /(^|\/)\.env(?:\.|$)/.test(entry) ||
    /(^|\/)(?:\.git|\.hermes|\.omo|\.codegraph|data|test-results|auth-reference)(?:\/|$)/.test(entry)
  );
  if (forbidden) {
    throw new Error(`npm package contains forbidden local content: ${forbidden}`);
  }

  const archive = path.join(packRoot, packResult.filename);
  run("npm", [
    "install",
    "--global",
    "--ignore-scripts",
    "--prefix",
    installRoot,
    archive,
  ], root);

  const executable = platform() === "win32"
    ? path.join(installRoot, "kana.cmd")
    : path.join(installRoot, "bin", "kana");
  const aliasExecutable = platform() === "win32"
    ? path.join(installRoot, "kana-alya.cmd")
    : path.join(installRoot, "bin", "kana-alya");
  await access(executable);
  await access(aliasExecutable);
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    fakeHermes,
    `#!/usr/bin/env node
const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("Hermes 0.20.1\\n");
  process.exit(0);
}
if (args[0] !== "serve") process.exit(2);
const portIndex = args.indexOf("--port");
const port = Number(args[portIndex + 1]);
writeFileSync(process.env.KANA_FAKE_HERMES_PID_FILE, String(process.pid));
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/health") {
    response.end(JSON.stringify({ ok: true, version: "0.20.1", auth_required: true }));
    return;
  }
  if (request.url === "/api/status") {
    response.end(JSON.stringify({ version: "0.20.1", config_version: 1 }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});
server.listen(port, "127.0.0.1");
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
`,
    { mode: 0o755 },
  );
  await chmod(fakeHermes, 0o755);
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    KANA_FAKE_HERMES_PID_FILE: fakeHermesPidFile,
  };

  const help = run(executable, ["--help"], root, environment);
  if (!help.stdout.includes("Start Kana and open the browser")) {
    throw new Error("installed Kana launcher did not render its help output.");
  }
  const aliasHelp = run(aliasExecutable, ["--help"], root, environment);
  if (!aliasHelp.stdout.includes("Start Kana and open the browser")) {
    throw new Error("installed kana-alya command alias did not render its help output.");
  }
  const doctor = run(executable, ["doctor"], root, environment);
  if (doctor.stdout.includes("first-run setup")) {
    throw new Error("kana doctor unexpectedly launched interactive setup.");
  }
  if (!doctor.stdout.includes(`Hermes: ${fakeHermes}`)) {
    throw new Error("kana doctor did not discover Hermes from the user's PATH.");
  }

  const port = await availablePort();
  const hermesPort = await availablePort();
  const child = spawn(executable, ["--no-open", "--port", String(port)], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let sessionCookie;
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    await waitFor(() => output.includes(`Kana is ready at http://127.0.0.1:${port}`), 30_000);
    if (output.includes("Kana first-run setup")) {
      throw new Error("the installed launcher blocked first start with terminal setup.");
    }
    const status = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
    if (!status.ok) throw new Error(`installed Kana health returned ${status.status}.`);
    const authState = await status.json();
    if (
      authState.authEnabled !== true
      || authState.usingDefaultPassword !== true
      || authState.defaultPassword !== "chankana123"
    ) {
      throw new Error("fresh npm installation did not expose the default login flow.");
    }
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "chankana123" }),
    });
    sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!login.ok || !sessionCookie) {
      throw new Error("fresh npm installation rejected the documented default password.");
    }
    const setup = await fetch(`http://127.0.0.1:${port}/api/kana/setup`, {
      headers: { Cookie: sessionCookie },
    });
    const setupState = await setup.json();
    if (!setup.ok || setupState.onboardingCompleted !== false) {
      throw new Error("the npm launcher did not preserve the in-app onboarding flow.");
    }
    const dataDirectory = path.join(home, ".local", "share", "kana");
    const configFile = path.join(dataDirectory, "config.json");
    const jwtSecretFile = path.join(dataDirectory, "jwt-secret");
    const config = JSON.parse(await readFile(configFile, "utf8"));
    const jwtSecret = (await readFile(jwtSecretFile, "utf8")).trim();
    if (config.deployment?.mode !== "local") {
      throw new Error("first npm launch did not create the default local config.json.");
    }
    if (
      config.tts?.provider !== "qwen3-local"
      || config.tts?.qwen3Local?.model !== "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
      || config.tts?.qwen3Local?.port !== 7860
    ) {
      throw new Error("first npm launch did not create the default local Qwen config.");
    }
    if (jwtSecret.length < 32) {
      throw new Error("first npm launch did not create a strong JWT session secret.");
    }
    if (((await stat(configFile)).mode & 0o777) !== 0o600) {
      throw new Error("generated config.json is not owner-only.");
    }
    if (((await stat(jwtSecretFile)).mode & 0o777) !== 0o600) {
      throw new Error("generated JWT secret is not owner-only.");
    }

    const passwordChange = await fetch(`http://127.0.0.1:${port}/api/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        currentPassword: "chankana123",
        newPassword: "npm-smoke-password",
      }),
    });
    if (!passwordChange.ok) {
      throw new Error(`installed Kana could not persist a custom password: ${passwordChange.status}.`);
    }
    sessionCookie = passwordChange.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    const changedStatus = await fetch(`http://127.0.0.1:${port}/api/auth/status`, {
      headers: { Cookie: sessionCookie },
    });
    const changedAuthState = await changedStatus.json();
    if (
      !changedStatus.ok
      || changedAuthState.usingDefaultPassword !== false
      || changedAuthState.defaultPassword !== null
    ) {
      throw new Error("custom password state was not reflected by the installed runtime.");
    }

    const appStateFile = path.join(dataDirectory, "appstate.db");
    const appState = new DatabaseSync(appStateFile, { readOnly: true });
    const authRow = appState
      .prepare("SELECT value FROM app_state WHERE key = 'auth.password'")
      .get();
    appState.close();
    const storedAuth = JSON.parse(authRow?.value ?? "null");
    if (
      typeof storedAuth?.passwordHash !== "string"
      || !storedAuth.passwordHash.startsWith("$2")
    ) {
      throw new Error("custom password hash was not stored in appstate.db.");
    }
    try {
      await stat(path.join(dataDirectory, "auth.json"));
      throw new Error("installed Kana wrote the obsolete auth.json password store.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const startedHermes = await fetch(
      `http://127.0.0.1:${port}/api/local-runtime/hermes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ action: "start", port: hermesPort }),
      },
    );
    const hermesState = await startedHermes.json();
    if (
      !startedHermes.ok
      || hermesState.state !== "running"
      || hermesState.executable !== fakeHermes
    ) {
      throw new Error(
        `installed Kana did not auto-start discovered Hermes: ${JSON.stringify(hermesState)}`,
      );
    }
    const foreignOrigin = await fetch(`http://127.0.0.1:${port}/api/kana/sessions`, {
      headers: { Origin: "https://untrusted.example" },
    });
    if (foreignOrigin.status !== 401) {
      throw new Error("installed Kana accepted an API request without a login session.");
    }
  } finally {
    try {
      await fetch(`http://127.0.0.1:${port}/api/local-runtime/hermes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof sessionCookie === "string" ? { Cookie: sessionCookie } : {}),
        },
        body: JSON.stringify({ action: "stop" }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // The explicit PID cleanup below handles a launcher/server failure.
    }
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  // The same installed artifact is a headless deployment, with a separate data root.
  const serverData = path.join(temporary, "server-data");
  const browserMarker = path.join(temporary, "browser-opened");
  await writeFile(path.join(fakeBin, "xdg-open"), `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.KANA_SMOKE_BROWSER_MARKER, "opened");
`, { mode: 0o755 });
  const serverPort = await availablePort();
  const server = spawn(executable, ["serve", "--port", String(serverPort)], {
    cwd: temporary,
    env: { ...environment, KANA_DATA_DIR: serverData, KANA_SMOKE_BROWSER_MARKER: browserMarker },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  try {
    await waitFor(() => serverOutput.includes("Kana is ready at"), 30_000);
    const login = await fetch(`http://127.0.0.1:${serverPort}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "chankana123" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!login.ok || !cookie) throw new Error("kana serve login failed");
    const configResponse = await fetch(`http://127.0.0.1:${serverPort}/api/kana/config`, { headers: { Cookie: cookie } });
    const config = await configResponse.json();
    if (config.deploymentMode !== "deployment" || config.path !== path.join(serverData, "config.json")) {
      throw new Error("kana serve did not select deployment mode and the requested data root");
    }
    try {
      await access(browserMarker);
      throw new Error("kana serve tried to open a browser");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  process.stdout.write(
    `npm package smoke test passed (${packResult.size} bytes packed, ${packResult.unpackedSize} bytes unpacked).\n`,
  );
} finally {
  try {
    const pid = Number((await readFile(fakeHermesPidFile, "utf8")).trim());
    if (Number.isInteger(pid) && pid > 1) process.kill(pid, "SIGTERM");
  } catch {
    // The fake Hermes either never started or already stopped cleanly.
  }
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out after ${timeoutMs / 1000} seconds`);
}
