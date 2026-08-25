import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";

// Single shared access password — deliberately no user management, mirroring
// the proven 9Router dashboard model: one bcrypt hash on disk (set via the
// authenticated change-password route) with an optional bootstrap password
// from the environment for fresh installs.

function authFile(): string {
  adoptLegacyKanaFile("auth.json");
  return path.join(resolveKanaDataDir(), "auth.json");
}

type PasswordStore = { passwordHash: string };

export function bootstrapPassword(): string | null {
  const value = process.env.KANA_ACCESS_PASSWORD?.trim();
  return value ? value : null;
}

export function isAuthEnabled(): boolean {
  return existsSync(authFile()) || Boolean(bootstrapPassword());
}

// Security contract: this stays true even when KANA_ALLOW_NO_AUTH=1 — the
// env var only records operator acknowledgment, the flag reports reality.
export function isInsecureNoAuthMode(): boolean {
  return process.env.NODE_ENV === "production" && !isAuthEnabled();
}

export function isNoAuthExplicitlyAllowed(): boolean {
  return process.env.KANA_ALLOW_NO_AUTH === "1";
}

function parseStore(raw: string): PasswordStore | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PasswordStore>;
    if (typeof parsed.passwordHash === "string" && parsed.passwordHash.length > 0) {
      return { passwordHash: parsed.passwordHash };
    }
  } catch {
    // An unreadable store must not lock the operator out of the bootstrap path.
  }
  return null;
}

async function readHash(): Promise<string | null> {
  if (!existsSync(authFile())) return null;
  try {
    return (await parseStore(await readFile(authFile(), "utf8")))?.passwordHash ?? null;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function verifyAccessPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const stored = await readHash();
  if (stored) return bcrypt.compare(password, stored);
  const bootstrap = bootstrapPassword();
  if (!bootstrap) return false;
  return safeEqual(password, bootstrap);
}

export async function changeAccessPassword(newPassword: string): Promise<void> {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("The new password must contain at least 8 characters.");
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await mkdir(resolveKanaDataDir(), { recursive: true });
  await writeFile(authFile(), JSON.stringify({ passwordHash }), { encoding: "utf8", mode: 0o600 });
}
