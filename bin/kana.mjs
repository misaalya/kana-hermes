#!/usr/bin/env node

// `kana` — launcher for the Kana web interface to Hermes Agent.

import { parseArgs } from "node:util";
import { doctor, openConfig, password, setup } from "./lib/commands.mjs";
import { manifest, resolveDataRoot } from "./lib/context.mjs";
import { LauncherError } from "./lib/errors.mjs";
import { runServer } from "./lib/server.mjs";
import { print, printError, PromptCancelledError, style, symbols } from "./lib/ui.mjs";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

const COMMANDS = {
  start: "Start Kana on this computer and open the browser",
  serve: "Run Kana headless for a VPS or systemd service",
  password: "Create or change the access password",
  setup: "Prepare optional local voice cloning (Qwen3-TTS)",
  config: "Open the advanced config.json",
  doctor: "Check Hermes, voice, password, and data locations",
};

const OPTIONS = [
  ["-p, --port <number>", `Web port (default ${DEFAULT_PORT}, or $KANA_PORT)`],
  ["    --host <address>", `Bind address for serve (default ${DEFAULT_HOST})`],
  ["    --no-open", "Do not open a browser"],
  ["    --stdin", "password: read the new password from standard input"],
  ["-v, --version", "Print the version"],
  ["-h, --help", "Show this help"],
];

function help() {
  const commandWidth = Math.max(...OPTIONS.map(([flags]) => flags.length)) + 2;
  const optionWidth = Math.max(...OPTIONS.map(([flags]) => flags.length)) + 2;
  print();
  print(`${style.accent(symbols.mark)} ${style.bold("Kana")} ${style.dim(manifest.version)} ${style.dim("— the visual interface for Hermes Agent")}`);
  print();
  print(`${style.bold("Usage")}  kana ${style.dim("[command] [options]")}`);
  print();
  print(style.bold("Commands"));
  for (const [name, description] of Object.entries(COMMANDS)) {
    const suffix = name === "start" ? ` ${style.dim("(default)")}` : "";
    print(`  ${name.padEnd(commandWidth)}${description}${suffix}`);
  }
  print();
  print(style.bold("Options"));
  for (const [flags, description] of OPTIONS) {
    print(`  ${flags.padEnd(optionWidth)}${description}`);
  }
  print();
  print(style.dim("  Data lives in $KANA_DATA_DIR, $XDG_DATA_HOME/kana, or ~/.local/share/kana."));
  print();
}

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      open: { type: "boolean", default: true },
      stdin: { type: "boolean", default: false },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1) {
    throw new LauncherError(`Unexpected argument: ${positionals[1]}`, "Run `kana --help` for usage.");
  }
  return { command: positionals[0] ?? "start", values };
}

async function main() {
  let parsed;
  try {
    parsed = parse(process.argv.slice(2));
  } catch (error) {
    if (error instanceof LauncherError) throw error;
    throw new LauncherError(error instanceof Error ? error.message : String(error), "Run `kana --help` for usage.");
  }
  const { command, values } = parsed;
  if (values.version) {
    print(manifest.version);
    return 0;
  }
  if (values.help || command === "help") {
    help();
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    throw new LauncherError(`Unknown command: ${command}`, "Run `kana --help` for usage.");
  }

  const dataRoot = resolveDataRoot();
  switch (command) {
    case "start":
    case "serve": {
      const port = Number(values.port ?? process.env.KANA_PORT ?? process.env.PORT ?? DEFAULT_PORT);
      return runServer({
        serving: command === "serve",
        host: values.host ?? DEFAULT_HOST,
        port,
        open: command === "start" && values.open,
        dataRoot,
      });
    }
    case "password":
      await password({ dataRoot, fromStdin: values.stdin });
      return 0;
    case "setup":
      await setup({ dataRoot });
      return 0;
    case "config":
      await openConfig({ dataRoot });
      return 0;
    case "doctor":
      await doctor({ dataRoot });
      return 0;
  }
  return 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof PromptCancelledError) {
    printError(style.dim("  Cancelled."));
    process.exitCode = 130;
  } else if (error instanceof LauncherError) {
    printError();
    printError(`${style.red(symbols.error)} ${error.message}`);
    if (error.hint) printError(`    ${style.dim(error.hint)}`);
    printError();
    process.exitCode = 1;
  } else {
    printError(`${style.red(symbols.error)} ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
