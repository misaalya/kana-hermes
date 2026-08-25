import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import {
  listTurnActivities,
  resetActivityStoreForTests,
  saveTurnActivities,
  type StoredTurnActivities,
} from "@/lib/server/activity-store";

// The store caches one SQLite handle per process, so every case points
// KANA_DATA_DIR at its own directory and resets the handle first.
const dataDir = mkdtempSync(path.join(tmpdir(), "kana-activity-test-"));
process.env.KANA_DATA_DIR = dataDir;

after(() => {
  resetActivityStoreForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

const KEY = "20260824_052417_fe475b";

function scopedDir(name: string): string {
  const dir = path.join(dataDir, name);
  fs.mkdirSync(dir, { recursive: true });
  process.env.KANA_DATA_DIR = dir;
  return dir;
}

function userVersion(dbPath: string): number {
  const database = new DatabaseSync(dbPath);
  try {
    const row = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  } finally {
    database.close();
  }
}

describe("activity store schema v2", () => {
  beforeEach(() => {
    resetActivityStoreForTests();
  });

  it("creates the ordinal schema on a fresh database and upserts by turn_index", () => {
    const dir = scopedDir("fresh");
    saveTurnActivities(KEY, 1000, [{ id: "a1" }], 0);
    saveTurnActivities(KEY, 2000, [{ id: "a2" }], 1);
    // Same ordinal, different anchor+payload: must UPDATE, not duplicate.
    saveTurnActivities(KEY, 9999, [{ id: "a2b" }], 1);

    const turns = listTurnActivities(KEY);
    assert.equal(turns.length, 2);
    assert.deepEqual(
      turns.map((turn) => turn.turn_index),
      [0, 1],
    );
    const second = turns[1] as StoredTurnActivities;
    assert.deepEqual(second.activities, [{ id: "a2b" }]);
    // The live write's real anchor survives the reconstructed overwrite.
    assert.equal(second.turn_anchor_ms, 2000);

    assert.equal(userVersion(path.join(dir, "activities.db")), 2);
  });

  it("migrates a v1 database in place and keeps legacy rows anchor-addressed", () => {
    const dir = scopedDir("v1");
    const legacyPath = path.join(dir, "activities.db");
    const legacy = new DatabaseSync(legacyPath);
    try {
      legacy.exec(`
        CREATE TABLE turn_activities (
          hermes_session_key TEXT NOT NULL,
          turn_anchor_ms     INTEGER NOT NULL,
          activities         TEXT NOT NULL,
          created_at         INTEGER NOT NULL,
          PRIMARY KEY (hermes_session_key, turn_anchor_ms)
        );
      `);
      legacy
        .prepare(
          `INSERT INTO turn_activities (hermes_session_key, turn_anchor_ms, activities, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(KEY, 1111, JSON.stringify([{ id: "legacy" }]), 1);
    } finally {
      legacy.close();
    }

    const turns = listTurnActivities(KEY);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turn_index, null);
    assert.deepEqual(turns[0]?.activities, [{ id: "legacy" }]);
    assert.equal(userVersion(legacyPath), 2);

    // Indexed writes coexist with the legacy row, and re-opening the
    // migrated database is idempotent.
    saveTurnActivities(KEY, 2222, [{ id: "new" }], 0);
    assert.equal(listTurnActivities(KEY).length, 2);
    resetActivityStoreForTests();
    assert.equal(listTurnActivities(KEY).length, 2);
    assert.equal(userVersion(legacyPath), 2);
  });
});
