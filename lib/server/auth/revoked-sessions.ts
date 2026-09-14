import type { DatabaseSync } from "node:sqlite";
import {
  appStateDatabase,
  onAppStateDatabaseReset,
} from "@/lib/server/app-state-store";

// Logout revocation list for session JWTs. Rows are kept only until the token
// would have expired, so the table stays as small as the set of live logins.

let schemaReady: DatabaseSync | null = null;
onAppStateDatabaseReset(() => {
  schemaReady = null;
});

function db(): DatabaseSync {
  const database = appStateDatabase();
  if (schemaReady !== database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS revoked_sessions (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
    schemaReady = database;
  }
  return database;
}

export function revokeSession(jti: string, expiresAtMs: number): void {
  const database = db();
  database.prepare("DELETE FROM revoked_sessions WHERE expires_at <= ?").run(Date.now());
  database
    .prepare("INSERT OR REPLACE INTO revoked_sessions (jti, expires_at) VALUES (?, ?)")
    .run(jti, Math.round(expiresAtMs));
}

export function isSessionRevoked(jti: string): boolean {
  return db().prepare("SELECT 1 FROM revoked_sessions WHERE jti = ?").get(jti) !== undefined;
}
