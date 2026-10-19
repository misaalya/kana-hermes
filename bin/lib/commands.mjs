// `kana doctor`, `kana setup`, `kana config`, `kana migrate`, and `kana password`.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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
import { KANA_DATA_DIR_ENV, migrateKanaDataRoot, planKanaDataRootMove } from "../../shared/data-dir.mjs";
import {
  configPath,
  manifest,
  readConfigSafely,
  voiceProviderName,
  runtimeRoot,
  serverEntry,
  userHome,
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
  symbols,
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

  const provider = voiceProviderName(config.value);
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

  const provider = voiceProviderName(config.value);
  if (provider !== "irodori-local") {
    status.info("Voice", `${provider} is configured; nothing to install.`);
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

const KILOBYTE = 1024;
const MEGABYTE = 1024 * KILOBYTE;
const GIGABYTE = 1024 * MEGABYTE;

/** A size a person can read at a glance. */
function formatBytes(bytes) {
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(1)} GB`;
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`;
  if (bytes >= KILOBYTE) return `${Math.round(bytes / KILOBYTE)} KB`;
  return `${bytes} B`;
}

/** "1 entry" / "3 entries". */
function formatEntries(count) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/** "1 file" / "3 files". */
function formatFiles(count) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function describeSkipReason(reason, target) {
  switch (reason) {
    case "target":
      return `already in ${displayPath(target)}`;
    case "missing":
      return "does not exist";
    case "unrecognized":
      return "holds nothing Kana writes";
    default:
      return reason;
  }
}

/**
 * The root `kana migrate` reads from: the one the operator named, or this
 * shell's KANA_DATA_DIR, which is the root the automatic path deliberately
 * leaves alone.
 */
function resolveMigrateSource({ from, dataRoot }) {
  const named = from?.trim() || process.env[KANA_DATA_DIR_ENV]?.trim() || "";
  if (!named) {
    throw new LauncherError(
      `This install already uses the default data root ${displayPath(dataRoot)}.`,
      `Name the root to move, for example: kana migrate --from /var/lib/kana`,
    );
  }
  if (!path.isAbsolute(named)) {
    throw new LauncherError(
      `The source must be an absolute path: ${named}`,
      `For example: kana migrate --from /var/lib/kana`,
    );
  }
  const source = path.resolve(named);
  let stats = null;
  try {
    stats = statSync(source);
  } catch {
    stats = null;
  }
  if (!stats?.isDirectory()) {
    throw new LauncherError(
      `The source is not a directory: ${displayPath(source)}`,
      "Run `kana doctor` to see where this installation keeps its data.",
    );
  }
  return source;
}

/** The root the data goes to: the standard `~/.kana`, or the one the operator named. */
function resolveMigrateDestination({ to, source }) {
  const fallback = path.join(userHome, ".kana");
  const named = to?.trim() || fallback;
  if (!path.isAbsolute(named)) {
    throw new LauncherError(
      `The destination must be an absolute path: ${named}`,
      `The default is ${displayPath(fallback)}.`,
    );
  }
  const destination = path.resolve(named);
  if (destination === source) {
    throw new LauncherError(
      "The destination is the source.",
      "Omit --to to use the default ~/.kana root, or name a different directory.",
    );
  }
  if (source.startsWith(`${destination}${path.sep}`) || destination.startsWith(`${source}${path.sep}`)) {
    throw new LauncherError(
      `The source and the destination overlap: ${displayPath(source)} and ${displayPath(destination)}`,
      "Choose two directories that do not contain each other.",
    );
  }
  return destination;
}

/**
 * `kana migrate` — an operator's explicit request to move a KANA_DATA_DIR root
 * into the standard data root. The automatic migration never touches a root the
 * operator named, so this command is the only way data leaves one, and it does
 * nothing the operator has not agreed to: it shows the plan, copies by default,
 * verifies every file it writes, and keeps the source until the operator
 * removes it.
 */
export async function migrate({ dataRoot, from, to, deleteSource, dryRun, force, assumeYes }) {
  const source = resolveMigrateSource({ from, dataRoot });
  const destination = resolveMigrateDestination({ to, source });
  const plan = planKanaDataRootMove({
    targetDir: destination,
    legacyDirs: [source],
    requireMarker: !force,
  });

  const unrecognized = plan.skip.find((skipped) => skipped.reason === "unrecognized");
  if (unrecognized) {
    throw new LauncherError(
      `${displayPath(unrecognized.name)} does not look like a Kana data root.`,
      "Kana moves only a root that holds appstate.db, activities.db, jwt-secret, voices/, or irodori/. Pass --force to move it anyway.",
    );
  }

  heading("Move a Kana data root");
  const bytes = plan.move.reduce((total, entry) => total + entry.bytes, 0);
  print(keyValues([
    ["From", displayPath(source)],
    ["To", displayPath(plan.target)],
    ["Entries", `${plan.move.length}`],
    ["Size", formatBytes(bytes)],
    ["Source after the move", deleteSource ? "removed, entry by entry" : "kept"],
  ], "  ").join("\n"));
  print();
  for (const entry of plan.move) {
    const detail = entry.directory
      ? `${formatFiles(entry.files)}, ${formatBytes(entry.bytes)}`
      : formatBytes(entry.bytes);
    print(`  ${style.dim(symbols.bullet)} ${entry.name}  ${style.dim(detail)}`);
  }
  for (const skipped of plan.skip) {
    status.info(displayPath(skipped.name), describeSkipReason(skipped.reason, plan.target));
  }
  print();

  if (!plan.move.length) {
    status.warning("Nothing to move", `Every entry is already in ${displayPath(plan.target)}.`);
    return;
  }

  if (process.env[KANA_DATA_DIR_ENV]?.trim()) {
    const configured = path.resolve(process.env[KANA_DATA_DIR_ENV].trim());
    if (configured === source) {
      status.warning(
        "Stop Kana first",
        `${displayPath(source)} is this shell's ${KANA_DATA_DIR_ENV}; a running server may be writing to its databases.`,
      );
    }
  }

  if (dryRun) {
    print(style.dim("  Dry run: nothing was changed."));
    return;
  }

  let agreed = assumeYes;
  if (!agreed) {
    if (!canPrompt()) {
      throw new LauncherError(
        "`kana migrate` needs an interactive terminal to confirm.",
        "Run it in a terminal, or pass --yes to confirm from a script.",
      );
    }
    const verb = deleteSource ? "Move" : "Copy";
    agreed = await promptConfirm(
      `${verb} ${formatEntries(plan.move.length)} from ${displayPath(source)} into ${displayPath(plan.target)}?`,
    );
  }
  if (!agreed) {
    print(style.dim("  Nothing was changed."));
    return;
  }

  print();
  const moved = migrateKanaDataRoot({
    targetDir: plan.target,
    legacyDirs: [source],
    requireMarker: !force,
    copyOnly: !deleteSource,
    log: (name, _fromDir, targetDir, result) => {
      status.success(
        name,
        result?.mode === "moved"
          ? `moved into ${displayPath(targetDir)}`
          : `copied and verified into ${displayPath(targetDir)}`,
      );
    },
    warn: (name, _fromDir, error) => {
      status.warning(name, `left in place: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  print();

  const unfinished = plan.move.length - moved.length;
  if (unfinished > 0) {
    status.warning(
      "Partly moved",
      `${unfinished} of ${plan.move.length} entries are still in ${displayPath(source)}; run the command again.`,
    );
  }

  const configured = process.env[KANA_DATA_DIR_ENV]?.trim();
  const configuredHere = configured && path.resolve(configured) === source;
  status.info(
    "Next",
    configuredHere
      ? `point the service at the new root: set ${KANA_DATA_DIR_ENV}=${plan.target}, or remove it, then restart Kana. Kana never edits a systemd unit.`
      : `restart Kana so it reads ${displayPath(plan.target)}.`,
  );
  if (!deleteSource) {
    status.info(
      "Source",
      `${displayPath(source)} is unchanged; delete it yourself once Kana reads the new root.`,
    );
  } else if (existsSync(source)) {
    status.info("Source", `${displayPath(source)} still holds entries that were left alone.`);
  }
  status.info("Check", "`kana doctor` prints the data root Kana will use.");
}
