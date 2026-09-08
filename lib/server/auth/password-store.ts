import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";
import {
  getAppStateEntry,
  setAppState,
} from "@/lib/server/app-state-store";

// Single shared access password — deliberately no user management. Fresh
// installs use one documented default so both the prebuilt npm runtime and a
// source checkout have the same first-login flow. Following 9Router's storage
// pattern, a bcrypt hash written by the authenticated change-password route is
// kept in Kana's primary SQLite state database and takes precedence.

export const DEFAULT_ACCESS_PASSWORD = "chankana123";
const PASSWORD_STATE_KEY = "auth.password";

function legacyAuthFile(): string {
  adoptLegacyKanaFile("auth.json");
  return path.join(resolveKanaDataDir(), "auth.json");
}

type PasswordStore = { passwordHash: string; sessionVersion?: string };
type PasswordState =
  | { status: "default" }
  | ({ status: "stored" } & PasswordStore)
  | { status: "invalid" };

function parseStore(value: unknown): PasswordStore | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<PasswordStore>;
  if (typeof parsed.passwordHash === "string" && parsed.passwordHash.length > 0) {
    if (parsed.sessionVersion !== undefined &&
        (typeof parsed.sessionVersion !== "string" || !parsed.sessionVersion)) return null;
    return { passwordHash: parsed.passwordHash, sessionVersion: parsed.sessionVersion };
  }
  return null;
}

function migrateLegacyStore(): PasswordState {
  const file = legacyAuthFile();
  if (!existsSync(file)) return { status: "default" };

  try {
    const parsed = parseStore(JSON.parse(readFileSync(file, "utf8")));
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

  const parsed = parseStore(entry.value);
  return parsed
    ? { status: "stored", ...parsed }
    : { status: "invalid" };
}

export function isUsingDefaultPassword(): boolean {
  return readPasswordState().status === "default";
}

/** Stored with the password hash so a password change revokes sessions atomically. */
export function accessSessionVersion(): string | null {
  const state = readPasswordState();
  if (state.status === "invalid") return null;
  return state.status === "stored" ? state.sessionVersion ?? "initial" : "initial";
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function verifyAccessPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const state = readPasswordState();
  if (state.status === "stored") return bcrypt.compare(password, state.passwordHash);
  if (state.status === "invalid") return false;
  return safeEqual(password, DEFAULT_ACCESS_PASSWORD);
}

export async function changeAccessPassword(newPassword: string): Promise<void> {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("The new password must contain at least 8 characters.");
  }
  // bcrypt silently ignores bytes after the first 72, including UTF-8 bytes.
  if (Buffer.byteLength(newPassword, "utf8") > 72) {
    throw new Error("The new password must contain at most 72 UTF-8 bytes.");
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  setAppState(PASSWORD_STATE_KEY, { passwordHash, sessionVersion: randomUUID() });
}
