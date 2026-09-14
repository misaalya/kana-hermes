// `kana doctor`, `kana setup`, `kana config`, and `kana password`.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { findExecutableSync } from "../../shared/executables.mjs";
import path from "node:path";
import { ensureConfigFile, sessionSecretReady, updateConfig } from "./bootstrap.mjs";
import {
  configPath,
  defaultConfig,
  manifest,
  packageRoot,
  readConfigSafely,
  runtimeRoot,
  serverEntry,
} from "./context.mjs";
import { LauncherError } from "./errors.mjs";
import { locateHermes, runningGateways } from "./hermes.mjs";
import {
  isPasswordConfigured,
  setPasswordFromText,
  setPasswordInteractively,
} from "./password.mjs";
import {
  canPrompt,
  displayPath,
  heading,
  keyValues,
  print,
  promptConfirm,
  readStdinLine,
  status,
  style,
} from "./ui.mjs";

const REQUIRED_NODE = manifest.engines?.node?.replace(/^>=\s*/, "") ?? "22.13";

function runChild(executable, args, extraEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnvironment },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with code ${code}`)),
    );
  });
}

function nodeVersionSatisfied() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const [requiredMajor, requiredMinor = 0] = REQUIRED_NODE.split(".").map(Number);
  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}

export async function doctor({ dataRoot }) {
  heading("Kana doctor");
  const config = readConfigSafely(dataRoot);
  const qwen = { ...defaultConfig.tts?.qwen3Local, ...config.value.tts?.qwen3Local };

  if (nodeVersionSatisfied()) status.success("Node.js", `v${process.versions.node}`);
  else status.error("Node.js", `v${process.versions.node} — Kana requires ${REQUIRED_NODE} or newer`);

  const { problem } = serverEntry();
  if (problem) status.error("Web runtime", problem);
  else status.success("Web runtime", displayPath(runtimeRoot));

  if (await isPasswordConfigured(dataRoot)) status.success("Access password", "set");
  else status.warning("Access password", "not set — run `kana password`");

  if (config.error) status.error("Config", config.error);
  else if (existsSync(configPath(dataRoot))) status.success("Config", displayPath(configPath(dataRoot)));
  else status.info("Config", "defaults (config.json is created on first start)");

  const hermes = await locateHermes(config.value);
  if (hermes.warning) status.warning(hermes.warning);
  if (hermes.executable) status.success("Hermes", displayPath(hermes.executable));
  else status.error("Hermes", "not found — install Hermes or set hermes.executable in config.json");

  const gateways = await runningGateways();
  if (gateways.length === 0) {
    status.info("Hermes gateway", "not running — Kana starts it when you connect");
  }
  for (const gateway of gateways) {
    if (gateway.tokenReadable) {
      status.success("Hermes gateway", `port ${gateway.port} (pid ${gateway.pid})`);
    } else {
      status.warning(
        "Hermes gateway",
        `port ${gateway.port} (pid ${gateway.pid}) — its session token is not readable; start it from Kana or as this user with HERMES_DASHBOARD_SESSION_TOKEN`,
      );
    }
  }

  const provider = config.value.tts?.provider ?? defaultConfig.tts?.provider ?? "qwen3-local";
  const uv = findExecutableSync("uv", { configured: config.value.tts?.qwen3Local?.uvExecutable });
  if (provider !== "qwen3-local") status.info("Voice", provider);
  else if (uv) status.success("Voice", `qwen3-local via ${displayPath(uv)}`);
  else status.warning("Voice", "qwen3-local needs uv — install uv or run `kana setup`");

  print();
  print(style.bold("  Locations"));
  print(keyValues([
    ["Data", displayPath(dataRoot)],
    ["Voice references", displayPath(path.join(dataRoot, "voices"))],
    ["Qwen runtime", displayPath(qwen.runtimeDirectory ?? path.join(dataRoot, "qwen-runtime"))],
    ["Qwen model cache", displayPath(qwen.cacheDirectory ?? path.join(dataRoot, "qwen3-tts-cache"))],
    ["Qwen voice profiles", displayPath(path.join(qwen.dataDirectory ?? path.join(dataRoot, "qwen3-tts"), "voices"))],
    ["Session secret", (await sessionSecretReady(dataRoot)) ? "ready" : "created on first start"],
  ], "    ").join("\n"));
  print();
}

export async function password({ dataRoot, fromStdin }) {
  if (fromStdin) {
    await setPasswordFromText(dataRoot, await readStdinLine());
    status.success("Access password saved.");
    return;
  }
  if (!canPrompt()) {
    throw new LauncherError(
      "`kana password` needs an interactive terminal.",
      "Pipe the password instead: printf '%s\\n' \"$PASSWORD\" | kana password --stdin",
    );
  }
  const existing = await isPasswordConfigured(dataRoot);
  heading(existing ? "Change the Kana access password" : "Create the Kana access password");
  if (existing) print(style.dim("  Everyone signed in, including other browsers, will need to sign in again.\n"));
  await setPasswordInteractively(dataRoot);
  status.success("Access password saved.", displayPath(dataRoot));
  print();
}

export async function setup({ dataRoot }) {
  heading("Kana voice setup");
  const config = readConfigSafely(dataRoot);
  const hermes = await locateHermes(config.value);
  if (hermes.executable) status.success("Hermes", displayPath(hermes.executable));
  else status.warning("Hermes", "not found — Kana starts, but chat needs Hermes");

  if (!canPrompt()) {
    status.info("Non-interactive terminal: nothing was changed. Run `kana setup` in a terminal.");
    print();
    return;
  }
  print();
  const prepare = await promptConfirm(
    "Set up local Qwen3-TTS voice cloning? Needs Python, uv, and about 4 GB",
    false,
  );
  if (!prepare) {
    status.info("No voice configuration was changed.");
    print();
    return;
  }
  const uv = findExecutableSync("uv", { configured: config.value.tts?.qwen3Local?.uvExecutable });
  if (!uv) {
    throw new LauncherError("uv was not found.", "Install uv (https://docs.astral.sh/uv/), then run `kana setup` again.");
  }
  const packagedService = path.join(runtimeRoot, "services", "qwen3-tts");
  const serviceRoot = existsSync(packagedService)
    ? packagedService
    : path.join(packageRoot, "services", "qwen3-tts");
  status.info("Preparing the isolated Qwen3-TTS Python environment…");
  await runChild(uv, ["sync", "--frozen", "--project", serviceRoot], {
    UV_PROJECT_ENVIRONMENT: path.join(dataRoot, "qwen-runtime"),
  });
  await updateConfig(dataRoot, (current) => {
    const tts = current.tts && typeof current.tts === "object" && !Array.isArray(current.tts) ? current.tts : {};
    const local = tts.qwen3Local && typeof tts.qwen3Local === "object" && !Array.isArray(tts.qwen3Local)
      ? tts.qwen3Local
      : {};
    return {
      ...current,
      tts: { ...tts, provider: "qwen3-local", qwen3Local: { ...defaultConfig.tts?.qwen3Local, ...local } },
    };
  });
  status.success("Qwen runtime is ready.", "The model downloads the first time Kana speaks.");
  print();
}

export async function openConfig({ dataRoot }) {
  const file = await ensureConfigFile(dataRoot);
  const editor = (process.env.VISUAL || process.env.EDITOR || "").trim();
  // Editors with arguments (e.g. "code -w") would need a shell; print the path instead.
  if (!editor || editor.includes(" ") || !canPrompt()) {
    print(file);
    if (!editor && canPrompt()) {
      print(style.dim("Set VISUAL or EDITOR to open it automatically, or edit this JSON file directly."));
    }
    return;
  }
  await runChild(editor, [file], {});
}
