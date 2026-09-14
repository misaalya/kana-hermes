// Hermes lookup for the launcher, using the discovery shared with the server.

import path from "node:path";
import {
  findHermesExecutable,
  hermesCandidateInputFromEnv,
  readHermesProcessToken,
  scanHermesServeProcesses,
} from "../../shared/hermes-discovery.mjs";
import { userHome } from "./context.mjs";

/** @returns {Promise<{ executable: string | null, warning: string | null }>} */
export async function locateHermes(config) {
  const explicit = process.env.KANA_HERMES_BIN?.trim();
  if (explicit && !path.isAbsolute(explicit)) {
    return { executable: null, warning: "KANA_HERMES_BIN must be an absolute path; it was ignored." };
  }
  const configured = config?.hermes?.executable;
  const configuredUsable = typeof configured === "string" && path.isAbsolute(configured);
  const executable = await findHermesExecutable(
    hermesCandidateInputFromEnv(process.env, {
      configured: configuredUsable ? configured : undefined,
      home: userHome,
    }),
  );
  return {
    executable,
    warning: configured !== undefined && !configuredUsable
      ? "hermes.executable in config.json must be an absolute path; it was ignored."
      : null,
  };
}

/** Running `hermes serve` gateways visible to this user, with token readability. */
export async function runningGateways() {
  const processes = await scanHermesServeProcesses();
  return Promise.all(
    processes.map(async (proc) => ({
      ...proc,
      tokenReadable: Boolean(await readHermesProcessToken(proc.pid)),
    })),
  );
}
