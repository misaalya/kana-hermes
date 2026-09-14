// `kana password` and the first-run password requirement.

import { existsSync } from "node:fs";
import path from "node:path";
import { userHome } from "./context.mjs";
import { LauncherError } from "./errors.mjs";
import {
  canPrompt,
  print,
  promptSecret,
  status,
  style,
} from "./ui.mjs";

// node:sqlite prints an ExperimentalWarning on Node 22; it is noise in a CLI.
let sqliteWarningSilenced = false;
function silenceSqliteWarning() {
  if (sqliteWarningSilenced) return;
  sqliteWarningSilenced = true;
  const emitWarning = process.emitWarning;
  process.emitWarning = function filteredWarning(warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
    return emitWarning.call(process, warning, ...rest);
  };
}

async function stateModules() {
  silenceSqliteWarning();
  const [database, password] = await Promise.all([
    import("../../shared/app-state-db.mjs"),
    import("../../shared/password.mjs"),
  ]);
  return { ...database, ...password };
}

async function databaseHasPassword(file) {
  const { openAppStateDatabase, hasStoredPassword } = await stateModules();
  const database = openAppStateDatabase(path.dirname(file));
  try {
    return hasStoredPassword(database);
  } finally {
    database.close();
  }
}

/**
 * True when the server will find a password. Earlier releases kept the hash
 * in auth.json or under ~/.kana; the server adopts those on first use, so
 * they count as configured too.
 */
export async function isPasswordConfigured(dataRoot) {
  const legacyRoot = path.join(userHome, ".kana");
  if ([dataRoot, legacyRoot].some((root) => existsSync(path.join(root, "auth.json")))) return true;
  const current = path.join(dataRoot, "appstate.db");
  if (existsSync(current)) return databaseHasPassword(current);
  const legacy = path.join(legacyRoot, "appstate.db");
  return legacyRoot !== dataRoot && existsSync(legacy) ? databaseHasPassword(legacy) : false;
}

async function storePassword(dataRoot, password) {
  const {
    hashPassword,
    newPasswordRecord,
    openAppStateDatabase,
    PASSWORD_STATE_KEY,
    writeAppState,
  } = await stateModules();
  const passwordHash = await hashPassword(password);
  const database = openAppStateDatabase(dataRoot);
  try {
    writeAppState(database, PASSWORD_STATE_KEY, newPasswordRecord(passwordHash));
  } finally {
    database.close();
  }
}

async function promptNewPassword() {
  const { passwordPolicyError, PASSWORD_MIN_LENGTH } = await import("../../shared/password-policy.mjs");
  print(style.dim(`  At least ${PASSWORD_MIN_LENGTH} characters. It never leaves this machine.`));
  print();
  for (;;) {
    const password = await promptSecret("New password:");
    const problem = passwordPolicyError(password);
    if (problem) {
      status.error(problem);
      continue;
    }
    const confirmation = await promptSecret("Confirm password:");
    if (confirmation !== password) {
      status.error("The passwords do not match. Try again.");
      continue;
    }
    return password;
  }
}

/** Interactive set/change. Returns false when no terminal is available. */
export async function setPasswordInteractively(dataRoot) {
  if (!canPrompt()) return false;
  const password = await promptNewPassword();
  await storePassword(dataRoot, password);
  return true;
}

/** Non-interactive set from the first line of stdin (for automation). */
export async function setPasswordFromText(dataRoot, password) {
  const { passwordPolicyError } = await import("../../shared/password-policy.mjs");
  const problem = passwordPolicyError(password);
  if (problem) throw new LauncherError(problem);
  await storePassword(dataRoot, password);
}
