import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";
import {
  appStateDatabase,
  getAppStateEntry,
  setAppState,
} from "@/lib/server/app-state-store";
import {
  newPasswordRecord,
  PASSWORD_STATE_KEY,
} from "@/shared/app-state-db.mjs";
import {
  hashPassword,
  isScryptHash,
  passwordPolicyError,
  verifyScryptHash,
} from "@/shared/password.mjs";

// Single shared access password — deliberately no user management and no
// built-in default. A fresh installation has NO password and refuses every
// login until the owner sets one on the server itself (`kana password`, or the
// first-run prompt of `kana`/`kana serve`). Setting it over the web would let
// whoever reaches a new VPS first claim it.
//
// The record lives in appstate.db (shared/app-state-db.mjs) so the launcher
// and this server read and write the same format. New hashes use scrypt;
// bcrypt hashes from earlier releases still verify and are upgraded in place.

type PasswordRecord = { passwordHash: string; sessionVersion?: string };
type PasswordState =
  | { status: "unset" }
  | ({ status: "stored" } & PasswordRecord)
  | { status: "invalid" };

function legacyAuthFile(): string {
  adoptLegacyKanaFile("auth.json");
  return path.join(resolveKanaDataDir(), "auth.json");
}

function parseRecord(value: unknown): PasswordRecord | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<PasswordRecord>;
  if (typeof parsed.passwordHash !== "string" || parsed.passwordHash.length === 0) return null;
  if (
    parsed.sessionVersion !== undefined &&
    (typeof parsed.sessionVersion !== "string" || !parsed.sessionVersion)
  ) {
    return null;
  }
  return { passwordHash: parsed.passwordHash, sessionVersion: parsed.sessionVersion };
}

function migrateLegacyStore(): PasswordState {
  const file = legacyAuthFile();
  if (!existsSync(file)) return { status: "unset" };

  try {
    const parsed = parseRecord(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed) return { status: "invalid" };

    // Persist first, remove second. A crash can leave the source file behind,
    // but it can never erase the only copy of the user's password hash.
    setAppState(PASSWORD_STATE_KEY, parsed);
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[kana] Password hash migrated to SQLite but ${file} could not be removed.`);
      }
    }
    console.info(`[kana] Migrated the password hash from ${file} into appstate.db.`);
    return { status: "stored", ...parsed };
  } catch {
    return { status: "invalid" };
  }
}

function readPasswordState(): PasswordState {
  const entry = getAppStateEntry<unknown>(PASSWORD_STATE_KEY);
  if (entry.status === "invalid") return { status: "invalid" };
  if (entry.status === "missing") return migrateLegacyStore();
  const parsed = parseRecord(entry.value);
  return parsed ? { status: "stored", ...parsed } : { status: "invalid" };
}

/** True once the owner has set a password. A corrupt record also counts, so it fails closed. */
export function isAccessPasswordConfigured(): boolean {
  return readPasswordState().status !== "unset";
}

/** Stored with the password hash so a password change revokes sessions atomically. */
export function accessSessionVersion(): string | null {
  const state = readPasswordState();
  return state.status === "stored" ? state.sessionVersion ?? "initial" : null;
}

const LEGACY_BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

async function verifyAgainstRecord(password: string, record: PasswordRecord): Promise<boolean> {
  if (isScryptHash(record.passwordHash)) {
    return verifyScryptHash(password, record.passwordHash);
  }
  if (!LEGACY_BCRYPT_PATTERN.test(record.passwordHash)) return false;
  // bcrypt ignores bytes after the first 72; never treat a longer candidate
  // as matching a prefix.
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  const valid = await bcrypt.compare(password, record.passwordHash);
  if (valid) await upgradeLegacyHash(password, record);
  return valid;
}

// Replace a verified bcrypt hash with scrypt, keeping the session version so
// nobody is signed out. Skipped if the record changed during verification.
async function upgradeLegacyHash(password: string, record: PasswordRecord): Promise<void> {
  try {
    if (passwordPolicyError(password)) return;
    const passwordHash = await hashPassword(password);
    const database = appStateDatabase();
    database.exec("BEGIN IMMEDIATE;");
    try {
      const current = readPasswordState();
      if (current.status === "stored" && current.passwordHash === record.passwordHash) {
        setAppState(PASSWORD_STATE_KEY, { ...record, passwordHash });
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } catch (error) {
    console.warn(
      `[kana] Could not upgrade the legacy password hash: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function verifyAccessPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const state = readPasswordState();
  if (state.status !== "stored") return false;
  return verifyAgainstRecord(password, state);
}

export async function changeAccessPassword(newPassword: string): Promise<void> {
  const policy = passwordPolicyError(newPassword);
  if (policy) throw new Error(policy);
  const passwordHash = await hashPassword(newPassword);
  setAppState(PASSWORD_STATE_KEY, newPasswordRecord(passwordHash));
}
