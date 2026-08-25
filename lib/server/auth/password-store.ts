import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";

// Single shared access password — deliberately no user management, mirroring
// the proven 9Router dashboard model. The hash lives in SQLite
// (`appstate.db`, table `auth_password`) under the unified KANA_DATA_DIR root.
//
// Fresh installs bootstrap with a well-known DEFAULT password ("123456")
// stored as a bcrypt hash — never plaintext anywhere on disk. Because the
// default is public knowledge, the login page and /api/auth/status surface a
// `usingDefaultPassword` flag so the UI can push the operator to change it;
// the change-password flow writes the new bcrypt hash into the same table.

const DEFAULT_PASSWORD = "123456";

type PasswordRow = { password_hash: string };

const globalKey = Symbol.for("kana.passwordStore");
type StoreGlobal = typeof globalThis & {
  [globalKey]?: DatabaseSync;
};

function dbPath(): string {
  adoptLegacyKanaFile("appstate.db");
  const dir = resolveKanaDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "appstate.db");
}

function db(): DatabaseSync {
  const shared = globalThis as StoreGlobal;
  shared[globalKey] ??= openDb();
  return shared[globalKey];
}

function openDb(): DatabaseSync {
  const database = new DatabaseSync(dbPath());
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_password (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  // Bootstrap: seed the default-password HASH exactly once. The plaintext
  // default never touches disk or the process environment.
  database
    .prepare(
      `INSERT INTO auth_password (id, password_hash, updated_at)
       VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .run(bcrypt.hashSync(DEFAULT_PASSWORD, 10), Date.now());
  return database;
}

/** Test seam: drop the cached handle so a test can point at another directory. */
export function resetPasswordStoreForTests(): void {
  const shared = globalThis as StoreGlobal;
  try {
    shared[globalKey]?.close();
  } catch {
    // The handle may already be closed.
  }
  delete shared[globalKey];
}

function readHash(): string {
  const row = db()
    .prepare("SELECT password_hash FROM auth_password WHERE id = 1")
    .get() as PasswordRow | undefined;
  if (!row?.password_hash) {
    // A tampered/empty row must not disable auth; re-seed the default.
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    db()
      .prepare(
        `INSERT INTO auth_password (id, password_hash, updated_at)
         VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash`,
      )
      .run(hash, Date.now());
    return hash;
  }
  return row.password_hash;
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function isDefaultPassword(password: string): boolean {
  return safeEqual(password, DEFAULT_PASSWORD);
}

/** True while the stored hash still matches the well-known default. */
export function isUsingDefaultPassword(): boolean {
  return bcrypt.compareSync(DEFAULT_PASSWORD, readHash());
}

export function isAuthEnabled(): boolean {
  // Authentication is always enabled: the table seeds itself with the
  // default-password hash on first use, so there is no unauthenticated mode.
  readHash();
  return true;
}

export async function verifyAccessPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  return bcrypt.compare(password, readHash());
}

export async function changeAccessPassword(newPassword: string): Promise<void> {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("The new password must contain at least 8 characters.");
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  db()
    .prepare(
      `INSERT INTO auth_password (id, password_hash, updated_at)
       VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
                                                     updated_at = excluded.updated_at`,
    )
    .run(passwordHash, Date.now());
}
