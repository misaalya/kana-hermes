// `kana doctor`, `kana setup`, `kana config`, and `kana password`.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  IRODORI_ASSETS_ARCHIVE,
  IRODORI_ENGINE_ARCHIVE,
  IRODORI_MODEL_FILE,
  IRODORI_MODEL_NAME,
  irodoriEngineInstalled,
  irodoriInstalledModel,
  irodoriInstallPaths,
} from "../../shared/irodori-release.mjs";
import { ensureConfigFile, sessionSecretReady } from "./bootstrap.mjs";
import {
  configPath,
  manifest,
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

/** @param {number} bytes */
function formatGigabytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Local voice install state, read from the same markers the server writes.
 * @param {string} dataRoot
 * @param {Record<string, any>} config
 */
function localVoiceState(dataRoot, config) {
  const local = config.tts?.irodoriLocal ?? {};
  const paths = irodoriInstallPaths({ dataRoot, installDirectory: local.installDirectory });
  const engine = irodoriEngineInstalled(paths);
  const model = irodoriInstalledModel(paths, local.modelPath);
  return { paths, engine, model };
}

export async function doctor({ dataRoot }) {
  heading("Kana doctor");
  const config = readConfigSafely(dataRoot);
  const voice = localVoiceState(dataRoot, config.value);

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

  const provider = config.value.tts?.provider === "openai-compatible" ? "openai-compatible" : "irodori-local";
  if (provider !== "irodori-local") status.info("Voice", provider);
  else if (voice.engine && voice.model) status.success("Voice", `${IRODORI_MODEL_NAME}, installed`);
  else status.info("Voice", "local engine not downloaded — optional, see `kana setup`");

  print();
  print(style.bold("  Locations"));
  print(keyValues([
    ["Data", displayPath(dataRoot)],
    ["Voice references", displayPath(path.join(dataRoot, "voices"))],
    ["Voice engine", displayPath(voice.paths.root)],
    ...(voice.model ? [["Voice model", displayPath(voice.model.path)]] : []),
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

  if (config.value.tts?.provider === "openai-compatible") {
    status.info("Voice", "an OpenAI-compatible provider is configured; nothing to install.");
    print();
    return;
  }
  const voice = localVoiceState(dataRoot, config.value);
  if (voice.engine && voice.model) {
    status.success("Voice", `${IRODORI_MODEL_NAME} is installed.`);
    print();
    return;
  }
  const download =
    (voice.engine ? 0 : IRODORI_ENGINE_ARCHIVE.sizeBytes + IRODORI_ASSETS_ARCHIVE.sizeBytes) +
    (voice.model ? 0 : IRODORI_MODEL_FILE.sizeBytes);
  print();
  print(`  Local voice uses ${IRODORI_MODEL_NAME} on the irodori-c engine (Linux x86-64, CPU only).`);
  print(`  It is optional and downloads about ${formatGigabytes(download)} into ${displayPath(voice.paths.root)}.`);
  print(style.dim("  Start the download from Kana: Settings → Voice → Download voice engine."));
  print(style.dim("  Progress is shown there; interrupted downloads resume, and every file is checksum-verified."));
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
