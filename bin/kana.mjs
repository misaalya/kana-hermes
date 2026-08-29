#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import readline from "node:readline/promises";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedRuntime = path.join(packageRoot, ".npm-package", "runtime");
const sourceRuntime = packageRoot;
const runtimeRoot = await exists(path.join(packagedRuntime, ".next", "BUILD_ID"))
  ? packagedRuntime
  : sourceRuntime;
const userHome = homedir();
const xdgRoot = (value, fallback) => {
  const candidate = value?.trim();
  return candidate && path.isAbsolute(candidate) ? candidate : fallback;
};
const dataRoot = path.resolve(
  xdgRoot(process.env.XDG_DATA_HOME, path.join(userHome, ".local", "share")),
  "kana",
);
const defaultConfigPath = path.join(packageRoot, "config", "default-config.json");
const defaultAdvancedConfig = JSON.parse(await readFile(defaultConfigPath, "utf8"));

const args = process.argv.slice(2);
const command = args[0]?.startsWith("-") ? "start" : args.shift() || "start";
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (name) => args.includes(name);

if (command === "help" || command === "--help" || command === "-h" || has("--help")) {
  process.stdout.write(`Kana — the local visual interface for Hermes Agent

Usage:
  kana                       Start Kana and open the browser
  kana setup                 Configure optional Qwen3-TTS voice cloning
  kana config                Open the editable advanced JSON configuration
  kana doctor                Check local dependencies and data locations

Options:
  --port <number>            Kana web port (default 3000)
  --no-open                  Do not open a browser automatically
  --dev-mocks                Expose development mock providers (source builds only)
\n`);
  process.exit(0);
}

// Keep every server-side file under the same user-owned data root. Resolve it
// before subcommands so `kana doctor` works on a completely fresh install.
const explicitDataRoot = process.env.KANA_DATA_DIR?.trim();
if (explicitDataRoot && !path.isAbsolute(explicitDataRoot)) {
  throw new Error("KANA_DATA_DIR must be an absolute path.");
}
const resolvedDataRoot = explicitDataRoot || dataRoot;
if (command === "config") {
  await openAdvancedConfig();
  process.exit(0);
}
if (command === "setup") {
  await runSetup();
  process.exit(0);
}

if (command === "doctor") {
  await printDoctor();
  process.exit(0);
}
if (command !== "start") {
  process.stderr.write(`Unknown Kana command: ${command}\nRun kana --help for usage.\n`);
  process.exit(1);
}

const port = Number(option("--port", process.env.KANA_PORT || "3000"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Kana port must be an integer between 1024 and 65535.");
}

await bootstrapUserState();
const detectedHermesExecutable = await findHermesExecutable();

const children = [];
const packagedServer = path.join(runtimeRoot, "server.js");
const packaged = await exists(packagedServer);
const require = createRequire(import.meta.url);
const appCommand = process.execPath;
const appArgs = packaged
  ? [packagedServer]
  : [
      require.resolve("next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ];
const app = spawn(
  appCommand,
  appArgs,
  {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      HOME: process.env.HOME || userHome,
      KANA_DATA_DIR: resolvedDataRoot,
      ...(detectedHermesExecutable
        ? { KANA_HERMES_BIN: detectedHermesExecutable }
        : {}),
      // The npm launcher is deliberately loopback-only. Acknowledge local
      // no-auth operation by default. Deployment mode is resolved by the
      // server from KANA_DEPLOYMENT_MODE or the editable config.json; remote
      // deployments still require explicit authentication.
      KANA_ALLOW_NO_AUTH: process.env.KANA_ALLOW_NO_AUTH || "1",
    },
    stdio: "inherit",
  },
);
children.push(app);

const url = `http://127.0.0.1:${port}`;
try {
  await waitForKana(url, app, 30_000);
  process.stdout.write(`\nKana is ready at ${url}\n`);
  if (!has("--no-open")) openBrowser(url);
} catch (error) {
  process.stderr.write(`Kana did not become ready: ${error.message}\n`);
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exit(1);
}

const shutdown = (signal) => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  if (signal) process.exit(0);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
app.once("exit", (code) => {
  shutdown();
  process.exitCode = code ?? 0;
});

async function runSetup() {
  process.stdout.write("\nKana optional voice setup\n");
  const hermes = await findHermesExecutable();
  process.stdout.write(
    hermes
      ? `✓ Hermes found: ${hermes}\n`
      : "! Hermes was not found on PATH. Kana can still start, but chat requires Hermes.\n",
  );
  let prepareQwen = false;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(
      "Set up local Qwen3-TTS voice cloning? It needs Python, uv, and about 4 GB free [y/N] ",
    );
    prompt.close();
    prepareQwen = /^y(es)?$/i.test(answer.trim());
  } else {
    process.stdout.write(
      "Non-interactive setup: Qwen was left disabled. Run `kana setup` in a terminal later.\n",
    );
  }
  if (prepareQwen) {
    const uv = findExecutable("uv");
    if (!uv) {
      process.stdout.write(
        "! uv was not found. Install uv, then run `kana setup` again to enable Qwen.\n",
      );
      prepareQwen = false;
    } else {
      process.stdout.write("Preparing the isolated Qwen3-TTS Python environment…\n");
      const serviceRoot = path.join(runtimeRoot, "services", "qwen3-tts");
      await runChild(uv, ["sync", "--project", serviceRoot], {
        UV_PROJECT_ENVIRONMENT: path.join(resolvedDataRoot, "qwen-runtime"),
      });
      await selectLocalQwenProvider();
      process.stdout.write(
        "✓ Qwen runtime is ready. The voice-cloning model downloads separately when Kana starts it.\n",
      );
    }
  }
  process.stdout.write(
    prepareQwen
      ? "Setup saved in Kana config.json. You can rerun it any time with `kana setup`.\n\n"
      : "No local Qwen configuration was changed.\n\n",
  );
}

async function ensureAdvancedConfig() {
  const advancedConfigPath = path.join(resolvedDataRoot, "config.json");
  await mkdir(path.dirname(advancedConfigPath), { recursive: true, mode: 0o700 });
  if (!(await exists(advancedConfigPath))) {
    try {
      await writeFile(
        advancedConfigPath,
        `${JSON.stringify(defaultAdvancedConfig, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  return advancedConfigPath;
}

async function openAdvancedConfig() {
  const advancedConfigPath = await ensureAdvancedConfig();
  const editor = (process.env.VISUAL || process.env.EDITOR || "").trim();
  if (!editor || editor.includes(" ") || !process.stdin.isTTY) {
    process.stdout.write(`${advancedConfigPath}\n`);
    if (!editor) {
      process.stdout.write(
        "Set VISUAL or EDITOR to open it automatically, or edit this JSON path directly.\n",
      );
    }
    return;
  }
  await runChild(editor, [advancedConfigPath], {});
}

async function bootstrapUserState() {
  await mkdir(resolvedDataRoot, { recursive: true, mode: 0o700 });
  await ensureAdvancedConfig();

  // The server also has an atomic lazy fallback, but creating this secret
  // before spawn makes the first global-launch state complete and avoids a
  // race between concurrent server workers. Operator-provided env secrets
  // remain authoritative and are never copied to disk.
  const environmentSecret = process.env.KANA_JWT_SECRET?.trim();
  if (environmentSecret && environmentSecret.length < 32) {
    throw new Error("KANA_JWT_SECRET must contain at least 32 characters.");
  }
  if (!environmentSecret) {
    const jwtSecretPath = path.join(resolvedDataRoot, "jwt-secret");
    if (!(await validSessionSecret(jwtSecretPath))) {
      try {
        await writeFile(jwtSecretPath, randomBytes(32).toString("hex"), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      if (!(await validSessionSecret(jwtSecretPath))) {
        throw new Error(
          `Kana's session secret at ${jwtSecretPath} is invalid. It must contain at least 32 characters.`,
        );
      }
    }
    await chmod(jwtSecretPath, 0o600);
  }
}

async function validSessionSecret(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim().length >= 32;
  } catch {
    return false;
  }
}

async function selectLocalQwenProvider() {
  const advancedConfigPath = await ensureAdvancedConfig();
  const current = JSON.parse(await readFile(advancedConfigPath, "utf8"));
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`${advancedConfigPath} must contain a JSON object.`);
  }
  const defaults = defaultAdvancedConfig.tts?.qwen3Local ?? {};
  const existingTts = current.tts && typeof current.tts === "object"
    && !Array.isArray(current.tts) ? current.tts : {};
  const existingLocal = existingTts.qwen3Local
    && typeof existingTts.qwen3Local === "object"
    && !Array.isArray(existingTts.qwen3Local) ? existingTts.qwen3Local : {};
  const next = {
    ...current,
    tts: {
      ...existingTts,
      provider: "qwen3-local",
      qwen3Local: { ...defaults, ...existingLocal },
    },
  };
  const temporary = `${advancedConfigPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, advancedConfigPath);
}

async function printDoctor() {
  const hermes = await findHermesExecutable();
  const uv = findExecutable("uv");
  const advancedConfigPath = path.join(resolvedDataRoot, "config.json");
  const secretReady = Boolean(process.env.KANA_JWT_SECRET?.trim())
    || await validSessionSecret(path.join(resolvedDataRoot, "jwt-secret"));
  let selectedTtsProvider = defaultAdvancedConfig.tts?.provider ?? "qwen3-local";
  if (await exists(advancedConfigPath)) {
    const value = JSON.parse(await readFile(advancedConfigPath, "utf8"));
    selectedTtsProvider = value?.tts?.provider || selectedTtsProvider;
  }
  process.stdout.write(
    [
      "Kana doctor",
      `Web runtime: ${runtimeRoot}`,
      `Data directory: ${resolvedDataRoot}`,
      `Hermes: ${hermes || "not found"}`,
      ...(!hermes
        ? [`Hermes override: set hermes.executable in ${advancedConfigPath}`]
        : []),
      `uv: ${uv || "not found"}`,
      `TTS provider: ${selectedTtsProvider}`,
      `Qwen runtime: managed lazily by Kana when qwen3-local is selected`,
      `Qwen model cache: ${path.join(resolvedDataRoot, "qwen3-tts-cache")}`,
      `Cloned voices: ${path.join(resolvedDataRoot, "qwen3-tts", "voices")}`,
      `Advanced config: ${advancedConfigPath}`,
      `JWT session secret: ${secretReady ? "ready" : "generated automatically on first start"}`,
      "",
    ].join("\n"),
  );
}

async function findHermesExecutable() {
  let configuredExecutable;
  const advancedConfigPath = path.join(resolvedDataRoot, "config.json");
  if (await exists(advancedConfigPath)) {
    try {
      const value = JSON.parse(await readFile(advancedConfigPath, "utf8"));
      configuredExecutable = value?.hermes?.executable;
      if (
        configuredExecutable !== undefined
        && (typeof configuredExecutable !== "string"
          || !path.isAbsolute(configuredExecutable))
      ) {
        throw new Error("hermes.executable must be an absolute path.");
      }
    } catch (error) {
      throw new Error(
        `Kana could not read ${advancedConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const hermesHome = process.env.HERMES_HOME?.trim()
    || path.join(userHome, ".hermes");
  const installDirectory = process.env.HERMES_INSTALL_DIR?.trim();
  const pathCandidates = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, platform() === "win32" ? "hermes.exe" : "hermes"));
  const explicitExecutable = process.env.KANA_HERMES_BIN?.trim();
  if (explicitExecutable && !path.isAbsolute(explicitExecutable)) {
    throw new Error("KANA_HERMES_BIN must be an absolute path.");
  }
  const candidates = [
    explicitExecutable,
    configuredExecutable,
    ...pathCandidates,
    path.join(hermesHome, "bin", platform() === "win32" ? "hermes.exe" : "hermes"),
    path.join(hermesHome, "venv", "bin", "hermes"),
    path.join(hermesHome, "hermes-agent", "venv", "bin", "hermes"),
    ...(installDirectory
      ? [
          path.join(installDirectory, "venv", "bin", "hermes"),
          path.join(installDirectory, "hermes"),
        ]
      : []),
    path.join(userHome, ".local", "bin", platform() === "win32" ? "hermes.exe" : "hermes"),
    process.env.PREFIX
      ? path.join(process.env.PREFIX, "bin", platform() === "win32" ? "hermes.exe" : "hermes")
      : undefined,
    "/usr/local/bin/hermes",
    "/usr/bin/hermes",
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH, Hermes-managed, and system install locations.
    }
  }
  return null;
}

function findExecutable(name) {
  const suffixes = platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const knownFolders = platform() === "win32"
    ? [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, name, "bin"),
        process.env.USERPROFILE && path.join(process.env.USERPROFILE, ".local", "bin"),
      ]
    : [path.join(userHome, ".local", "bin"), "/usr/local/bin", "/usr/bin"];
  const folders = [
    ...(process.env.PATH || "").split(path.delimiter),
    ...knownFolders.filter(Boolean),
  ];
  for (const folder of [...new Set(folders)]) {
    if (!folder) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(folder, `${name}${suffix}`);
      try {
        accessSync(candidate);
        return candidate;
      } catch {
        // Continue through PATH without invoking a shell.
      }
    }
  }
  return null;
}

function accessSync(candidate) {
  const require = createRequire(import.meta.url);
  require("node:fs").accessSync(candidate, constants.X_OK);
}

async function runChild(executable, childArgs, extraEnvironment) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, childArgs, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnvironment },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with code ${code}`)),
    );
  });
}

async function waitForKana(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `the web process exited with code ${child.exitCode}; port ${new URL(url).port} may already be in use`,
      );
    }
    try {
      const response = await fetch(`${url}/api/auth/status`, {
        signal: AbortSignal.timeout(1_000),
      });
      const status = response.ok ? await response.json() : null;
      if (
        status &&
        typeof status === "object" &&
        typeof status.authEnabled === "boolean"
      ) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout after ${timeoutMs / 1000} seconds`);
}

function openBrowser(url) {
  const specification =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const opener = spawn(specification[0], specification[1], {
    detached: true,
    stdio: "ignore",
  });
  opener.once("error", () => {});
  opener.unref();
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
