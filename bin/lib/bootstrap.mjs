// First-start state that must exist before the server spawns.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { configPath, defaultConfig } from "./context.mjs";

const MIN_SECRET_LENGTH = 32;

/** Create an owner-only config.json with the bundled defaults, never overwriting. */
export async function ensureConfigFile(dataRoot) {
  const file = configPath(dataRoot);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) {
    try {
      await writeFile(file, `${JSON.stringify(defaultConfig, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  return file;
}

async function validSessionSecret(file) {
  try {
    return (await readFile(file, "utf8")).trim().length >= MIN_SECRET_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Creating the signing secret before spawn avoids a first-request race.
 * Operator-provided KANA_JWT_SECRET stays authoritative and is never copied.
 */
export async function ensureSessionSecret(dataRoot) {
  const environmentSecret = process.env.KANA_JWT_SECRET?.trim();
  if (environmentSecret) {
    if (environmentSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(`KANA_JWT_SECRET must contain at least ${MIN_SECRET_LENGTH} characters.`);
    }
    return;
  }
  const file = `${dataRoot}/jwt-secret`;
  if (!(await validSessionSecret(file))) {
    try {
      await writeFile(file, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (!(await validSessionSecret(file))) {
      throw new Error(`Kana's session secret at ${file} is invalid. It must contain at least ${MIN_SECRET_LENGTH} characters.`);
    }
  }
  await chmod(file, 0o600);
}

export async function sessionSecretReady(dataRoot) {
  return Boolean(process.env.KANA_JWT_SECRET?.trim()) || validSessionSecret(`${dataRoot}/jwt-secret`);
}
