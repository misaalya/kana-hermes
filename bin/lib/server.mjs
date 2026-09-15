// `kana` (local, opens a browser) and `kana serve` (headless deployment).

import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { platform } from "node:os";
import { ensureConfigFile, ensureSessionSecret } from "./bootstrap.mjs";
import {
  manifest,
  readConfigSafely,
  runtimeRoot,
  serverEntry,
  userHome,
} from "./context.mjs";
import { LauncherError } from "./errors.mjs";
import { locateHermes } from "./hermes.mjs";
import { isPasswordConfigured, setPasswordInteractively } from "./password.mjs";
import {
  box,
  boxValueWidth,
  canPrompt,
  displayPath,
  keyValues,
  print,
  printError,
  spinner,
  status,
  style,
  symbols,
  truncateMiddle,
} from "./ui.mjs";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const MAX_BUFFERED_OUTPUT = 64 * 1024;

function validateNetwork({ serving, host, port }) {
  if (!isIP(host) && host !== "localhost") {
    throw new LauncherError("--host must be an IP address or localhost.");
  }
  if (!serving && host !== "127.0.0.1" && host !== "localhost") {
    throw new LauncherError("`kana` only listens on this computer.", "Use `kana serve --host <address>` to listen on another address.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new LauncherError("The port must be an integer between 1024 and 65535.");
  }
}

async function requirePassword(dataRoot, serving) {
  if (await isPasswordConfigured(dataRoot)) return;
  if (!canPrompt()) {
    throw new LauncherError(
      "No access password is set for this Kana installation.",
      [
        `Run ${style.bold("kana password")} once in a terminal${serving ? " as the service user" : ""}, then start Kana again.`,
        `For automation: ${style.bold("printf '%s\\n' \"$PASSWORD\" | kana password --stdin")}`,
      ].join("\n    "),
    );
  }
  print();
  for (const line of box(
    [
      style.bold("Welcome to Kana"),
      "",
      "Create the password you will use to sign in.",
      style.dim("Kana has no default password, so nobody else can claim a new installation."),
    ],
  )) print(line);
  print();
  await setPasswordInteractively(dataRoot);
  status.success("Password saved.");
  print();
}

function openBrowser(url) {
  const [command, args] = platform() === "darwin"
    ? ["open", [url]]
    : platform() === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.once("error", () => {});
  opener.unref();
}

async function waitUntilReady(url, child, output) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = output.text().trim();
      throw new LauncherError(
        `The web server exited with code ${child.exitCode} before it was ready.`,
        tail ? tail.split("\n").slice(-12).join("\n    ") : undefined,
      );
    }
    try {
      const response = await fetch(`${url}/api/auth/status`, { signal: AbortSignal.timeout(1_000) });
      const body = response.ok ? await response.json() : null;
      if (body && typeof body.authEnabled === "boolean") return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new LauncherError(`The web server did not become ready within ${READY_TIMEOUT_MS / 1000} seconds.`);
}

function outputBuffer() {
  let text = "";
  return {
    append(chunk) {
      text = `${text}${chunk}`.slice(-MAX_BUFFERED_OUTPUT);
    },
    text: () => text,
  };
}

export async function runServer({ serving, host, port, open, dataRoot }) {
  validateNetwork({ serving, host, port });
  const { entry, problem } = serverEntry();
  if (!entry) throw new LauncherError(problem);

  await ensureConfigFile(dataRoot);
  await ensureSessionSecret(dataRoot);
  await requirePassword(dataRoot, serving);

  const config = readConfigSafely(dataRoot);
  if (config.error) status.warning("config.json could not be read; defaults are used.", config.error);
  const hermes = await locateHermes(config.value);
  if (hermes.warning) status.warning(hermes.warning);

  const child = spawn(
    process.execPath,
    // node:sqlite is stable enough for Kana; keep its experimental notice out of logs.
    ["--disable-warning=ExperimentalWarning", entry],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        HOSTNAME: host,
        PORT: String(port),
        HOME: userHome,
        KANA_DATA_DIR: dataRoot,
        ...(serving ? { KANA_DEPLOYMENT_MODE: "deployment" } : {}),
        ...(hermes.executable ? { KANA_HERMES_BIN: hermes.executable } : {}),
      },
      // A headless service logs straight to its journal; the local launcher
      // keeps the terminal tidy and shows server output only when it matters.
      stdio: serving ? "inherit" : ["ignore", "pipe", "pipe"],
    },
  );
  const output = outputBuffer();
  let ready = false;
  child.stdout?.on("data", (chunk) => (ready ? process.stdout.write(style.dim(chunk.toString())) : output.append(chunk)));
  child.stderr?.on("data", (chunk) => (ready ? process.stderr.write(chunk) : output.append(chunk)));

  let stopRequested = false;
  const stop = (signal) => {
    stopRequested = true;
    if (child.exitCode === null) child.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const url = `http://${isIP(probeHost) === 6 ? `[${probeHost}]` : probeHost}:${port}`;
  const progress = spinner(serving ? `Starting Kana ${manifest.version} on ${host}:${port}` : "Starting Kana…");
  try {
    await waitUntilReady(url, child, output);
  } catch (error) {
    progress.fail("Kana could not start.");
    stop("SIGTERM");
    throw error;
  }
  ready = true;
  progress.stop();

  // Builds before Irodori wrote "qwen3-local"; the server maps it to the local engine.
  const voiceProvider = config.value.tts?.provider === "openai-compatible" ? "openai-compatible" : "irodori-local";
  if (serving) {
    status.success(`Kana is ready at ${url}`);
    print(keyValues([
      ["Data", dataRoot],
      ["Hermes", hermes.executable ?? "not found (set hermes.executable in config.json)"],
      ["Voice", voiceProvider],
    ]).join("\n"));
  } else {
    print();
    for (const line of box(
      [
        `${style.green(symbols.success)} Ready at ${style.bold(style.accent(url))}`,
        "",
        ...keyValues([
          ["Data", truncateMiddle(displayPath(dataRoot), boxValueWidth(6))],
          ["Hermes", hermes.executable
            ? truncateMiddle(displayPath(hermes.executable), boxValueWidth(6))
            : style.yellow("not found — run kana doctor")],
          ["Voice", voiceProvider],
        ], ""),
      ],
      { title: `${style.accent(symbols.mark)} ${style.bold(`Kana ${manifest.version}`)}` },
    )) print(line);
    print(style.dim("  Press Ctrl+C to stop."));
    print();
    if (open) openBrowser(url);
  }

  const { exitCode, signal } = await new Promise((resolve) =>
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })),
  );
  // Ctrl+C reaches the whole terminal process group, so the server may exit
  // from the same SIGINT before this process handles it; 130/143 are the
  // conventional exit codes for SIGINT/SIGTERM.
  const stoppedOnRequest =
    stopRequested ||
    signal === "SIGINT" ||
    signal === "SIGTERM" ||
    exitCode === 130 ||
    exitCode === 143;
  if (stoppedOnRequest) {
    if (!serving) print(style.dim("  Kana stopped."));
    return 0;
  }
  const code = exitCode ?? 1;
  if (code !== 0) printError(`${style.red(symbols.error)} The web server stopped unexpectedly (code ${code}).`);
  return code;
}
