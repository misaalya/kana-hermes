#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
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
const configRoot = path.resolve(
  process.env.XDG_CONFIG_HOME || path.join(userHome, ".config"),
  "kana",
);
const dataRoot = path.resolve(
  process.env.XDG_DATA_HOME || path.join(userHome, ".local", "share"),
  "kana",
);
const cacheRoot = path.resolve(
  process.env.XDG_CACHE_HOME || path.join(userHome, ".cache"),
  "kana",
);
const configPath = path.join(configRoot, "launcher.json");

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
  kana doctor                Check local dependencies and data locations

Options:
  --port <number>            Kana web port (default 3000)
  --no-open                  Do not open a browser automatically
  --dev-mocks                Expose development mock providers (source builds only)
  --skip-setup               Skip the first-run terminal setup
\n`);
  process.exit(0);
}

await mkdir(configRoot, { recursive: true });
await mkdir(dataRoot, { recursive: true });
await mkdir(cacheRoot, { recursive: true });

let launcherConfig = await readConfig();
if (command === "setup" || (!launcherConfig.setupCompleted && !has("--skip-setup"))) {
  launcherConfig = await runSetup(launcherConfig);
  if (command === "setup") process.exit(0);
}

if (command === "doctor") {
  await printDoctor(launcherConfig);
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

const children = [];
if (launcherConfig.qwenEnabled) {
  const qwen = await startQwen();
  if (qwen) children.push(qwen);
}

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const app = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    stdio: "inherit",
  },
);
children.push(app);

const url = `http://127.0.0.1:${port}`;
try {
  await waitForHttp(url, 30_000);
  process.stdout.write(`\nKana is ready at ${url}\n`);
  if (!has("--no-open")) openBrowser(url);
} catch (error) {
  process.stderr.write(`Kana did not become ready: ${error.message}\n`);
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

async function runSetup(current) {
  process.stdout.write("\nKana first-run setup\n");
  const hermes = findExecutable("hermes");
  process.stdout.write(
    hermes
      ? `✓ Hermes found: ${hermes}\n`
      : "! Hermes was not found on PATH. Kana can still start, but chat requires Hermes.\n",
  );
  let qwenEnabled = Boolean(current.qwenEnabled);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(
      "Set up local Qwen3-TTS voice cloning? It needs Python, uv, and about 4 GB free [y/N] ",
    );
    prompt.close();
    qwenEnabled = /^y(es)?$/i.test(answer.trim());
  } else {
    process.stdout.write(
      "Non-interactive setup: Qwen was left disabled. Run `kana setup` in a terminal later.\n",
    );
  }
  if (qwenEnabled) {
    const uv = findExecutable("uv");
    if (!uv) {
      process.stdout.write(
        "! uv was not found. Install uv, then run `kana setup` again to enable Qwen.\n",
      );
      qwenEnabled = false;
    } else {
      process.stdout.write("Preparing the isolated Qwen3-TTS Python environment…\n");
      const serviceRoot = path.join(runtimeRoot, "services", "qwen3-tts");
      await runChild(uv, ["sync", "--project", serviceRoot], {
        UV_PROJECT_ENVIRONMENT: path.join(dataRoot, "qwen-runtime"),
      });
      process.stdout.write(
        "✓ Qwen runtime is ready. The voice-cloning model downloads separately when Kana starts it.\n",
      );
    }
  }
  const next = { version: 1, setupCompleted: true, qwenEnabled };
  await writeConfig(next);
  process.stdout.write("Setup saved. You can rerun it any time with `kana setup`.\n\n");
  return next;
}

async function startQwen() {
  const uv = findExecutable("uv");
  if (!uv) {
    process.stderr.write("Qwen is enabled but uv is unavailable; continuing without voice.\n");
    return null;
  }
  const serviceRoot = path.join(runtimeRoot, "services", "qwen3-tts");
  process.stdout.write(
    "Starting Qwen3-TTS. Its Base model may download into the separate Kana cache on first use…\n",
  );
  return spawn(uv, ["run", "--project", serviceRoot, "kana-qwen3-tts"], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: path.join(dataRoot, "qwen-runtime"),
      KANA_TTS_CACHE_DIR: path.join(cacheRoot, "qwen3-tts"),
      KANA_TTS_DATA_DIR: path.join(dataRoot, "qwen3-tts"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function printDoctor(current) {
  const hermes = findExecutable("hermes");
  const uv = findExecutable("uv");
  process.stdout.write(
    [
      "Kana doctor",
      `Web runtime: ${runtimeRoot}`,
      `Hermes: ${hermes || "not found"}`,
      `uv: ${uv || "not found"}`,
      `Qwen enabled: ${current.qwenEnabled ? "yes" : "no"}`,
      `Qwen model cache: ${path.join(cacheRoot, "qwen3-tts")}`,
      `Cloned voices: ${path.join(dataRoot, "qwen3-tts", "voices")}`,
      `Launcher config: ${configPath}`,
      "",
    ].join("\n"),
  );
}

function findExecutable(name) {
  const suffixes = platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const folder of (process.env.PATH || "").split(path.delimiter)) {
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

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
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

async function readConfig() {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8"));
    return {
      version: 1,
      setupCompleted: value.setupCompleted === true,
      qwenEnabled: value.qwenEnabled === true,
    };
  } catch {
    return { version: 1, setupCompleted: false, qwenEnabled: false };
  }
}

async function writeConfig(value) {
  const temporary = `${configPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
}
