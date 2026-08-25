import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import path from "node:path";
import {
  getAppState,
  resetAppStateStoreForTests,
  setAppState,
} from "@/lib/server/app-state-store";

function useTempDataDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kana-appstate-"));
  process.env.KANA_DATA_DIR = dir;
  resetAppStateStoreForTests();
  return dir;
}

describe("app state store (sqlite)", () => {
  afterEach(() => {
    resetAppStateStoreForTests();
    delete process.env.KANA_DATA_DIR;
  });

  it("returns null for unknown keys and persists round-trips", () => {
    const dir = useTempDataDir();
    assert.equal(getAppState("onboarding"), null);
    setAppState("onboarding", { completedAt: 123 });
    assert.deepEqual(getAppState("onboarding"), { completedAt: 123 });
    assert.ok(path.join(dir, "appstate.db"));
  });

  it("upserts the same key and survives a reopen", () => {
    useTempDataDir();
    setAppState("flag", { v: 1 });
    setAppState("flag", { v: 2 });
    assert.deepEqual(getAppState("flag"), { v: 2 });
    resetAppStateStoreForTests();
    assert.deepEqual(getAppState("flag"), { v: 2 });
  });

  it("treats a corrupt row as missing instead of throwing", () => {
    const dir = useTempDataDir();
    // Write through once so the table exists, then corrupt it directly.
    setAppState("broken", { ok: true });
    resetAppStateStoreForTests();
    delete process.env.KANA_DATA_DIR;
    process.env.KANA_DATA_DIR = dir;
    const raw = new DatabaseSync(path.join(dir, "appstate.db"));
    raw.prepare("UPDATE app_state SET value = '{not json' WHERE key = 'broken'").run();
    raw.close();
    resetAppStateStoreForTests();
    assert.equal(getAppState("broken"), null);
    rmSync(dir, { recursive: true, force: true });
  });
});
