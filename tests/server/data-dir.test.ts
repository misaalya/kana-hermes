import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  KANA_DATA_DIR_ENV,
  ensureKanaDataRootMigrated,
  kanaMovesLegacyData,
  migrateLegacyKanaFile,
  resolveKanaDataDir,
  resolveKanaDataDirFrom,
} from "@/lib/server/data-dir";
import { kanaLegacyDataDirsFrom, looksLikeKanaDataRoot, migrateKanaDataRoot } from "@/shared/data-dir.mjs";

after(() => {
  delete process.env[KANA_DATA_DIR_ENV];
});

describe("data dir resolution precedence", () => {
  it("prefers an explicit KANA_DATA_DIR over every other source", () => {
    assert.equal(
      resolveKanaDataDirFrom({
        kanaDataDir: "/srv/kana-data",
        home: "/home/kana",
      }),
      "/srv/kana-data",
    );
  });

  it("rejects a relative KANA_DATA_DIR instead of writing state under cwd", () => {
    assert.throws(
      () => resolveKanaDataDirFrom({ kanaDataDir: "relative/data", home: "/home/kana" }),
      /KANA_DATA_DIR must be an absolute path/,
    );
  });

  it("uses $HOME/.kana as the default, whatever XDG_DATA_HOME says", () => {
    assert.equal(
      resolveKanaDataDirFrom({ home: "/home/kana" }),
      path.join("/home/kana", ".kana"),
    );
  });

  it("throws naming the env var when nothing is resolvable in production", () => {
    assert.throws(
      () => resolveKanaDataDirFrom({ kanaDataDir: "", home: "" }),
      (error: Error) => error.message.includes(KANA_DATA_DIR_ENV),
    );
  });

  it("keeps a dev-only cwd fallback instead of throwing outside production", () => {
    const resolved = resolveKanaDataDir({
      NODE_ENV: "development",
      HOME: "",
    });
    assert.equal(resolved, path.join(process.cwd(), "data"));
  });

  it("does not hide an explicit relative KANA_DATA_DIR in development", () => {
    assert.throws(
      () => resolveKanaDataDir({ NODE_ENV: "development", KANA_DATA_DIR: "relative" }),
      /must be an absolute path/,
    );
  });
});

describe("legacy data roots", () => {
  it("lists the earlier roots newest layout first, ending at the cwd fallback", () => {
    assert.deepEqual(
      kanaLegacyDataDirsFrom({
        xdgDataHome: "/xdg/data",
        home: "/home/kana",
        cwd: "/srv/app",
      }),
      [
        path.join("/xdg/data", "kana"),
        path.join("/home/kana", ".local", "share", "kana"),
        path.join("/srv/app", "data"),
      ],
    );
  });

  it("ignores a relative XDG_DATA_HOME per the XDG spec", () => {
    assert.deepEqual(
      kanaLegacyDataDirsFrom({ xdgDataHome: "relative/path", home: "/home/kana", cwd: "/srv/app" }),
      [
        path.join("/home/kana", ".local", "share", "kana"),
        path.join("/srv/app", "data"),
      ],
    );
  });

  it("recognizes a directory Kana wrote and rejects an unrelated one", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kana-root-marker-"));
    try {
      const ours = path.join(root, "ours");
      const theirs = path.join(root, "theirs");
      const generic = path.join(root, "generic");
      mkdirSync(ours, { recursive: true });
      mkdirSync(theirs, { recursive: true });
      mkdirSync(generic, { recursive: true });
      writeFileSync(path.join(ours, "activities.db"), "");
      writeFileSync(path.join(theirs, "notes.txt"), "");
      // config.json and auth.json are common file names, so on their own they
      // must not make a project folder look like a Kana root.
      writeFileSync(path.join(generic, "config.json"), "{}");
      writeFileSync(path.join(generic, "auth.json"), "{}");
      assert.equal(looksLikeKanaDataRoot(ours), true);
      assert.equal(looksLikeKanaDataRoot(theirs), false);
      assert.equal(looksLikeKanaDataRoot(generic), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("legacy data root migration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kana-data-root-test-"));

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("moves files, the voice library, and removes the emptied source root", () => {
    const legacy = path.join(root, "move", "legacy");
    const target = path.join(root, "move", "target");
    mkdirSync(path.join(legacy, "voices"), { recursive: true });
    writeFileSync(path.join(legacy, "config.json"), "{}");
    writeFileSync(path.join(legacy, "auth.json"), "{}");
    writeFileSync(path.join(legacy, "voices", "haru.json"), "{}");

    const moved = migrateKanaDataRoot({ targetDir: target, legacyDirs: [legacy] });

    assert.deepEqual(moved.sort(), ["auth.json", "config.json", "voices"]);
    assert.equal(existsSync(path.join(target, "config.json")), true);
    assert.equal(existsSync(path.join(target, "voices", "haru.json")), true);
    assert.equal(existsSync(legacy), false);
  });

  it("never overwrites the target and takes the newest copy of a file", () => {
    const older = path.join(root, "newest", "older");
    const newer = path.join(root, "newest", "newer");
    const target = path.join(root, "newest", "target");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(older, "auth.json"), "old");
    writeFileSync(path.join(newer, "auth.json"), "new");
    writeFileSync(path.join(target, "jwt-secret"), "kept");
    utimesSync(path.join(older, "auth.json"), new Date(1_000), new Date(1_000));

    // auth.json alone is not a Kana marker, so this test isolates the
    // newest-wins rule by naming its sources explicitly.
    migrateKanaDataRoot({ targetDir: target, legacyDirs: [older, newer], requireMarker: false });

    assert.equal(readFileSync(path.join(target, "auth.json"), "utf8"), "new");
    assert.equal(readFileSync(path.join(target, "jwt-secret"), "utf8"), "kept");
    // The copy that lost the newest-match is left where it was: Kana never
    // deletes data it did not take.
    assert.equal(existsSync(path.join(older, "auth.json")), true);
    assert.equal(existsSync(path.join(newer, "auth.json")), false);
  });

  it("keeps the target's own file when both sides hold it", () => {
    const legacy = path.join(root, "keep", "legacy");
    const target = path.join(root, "keep", "target");
    mkdirSync(legacy, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(legacy, "jwt-secret"), "old");
    writeFileSync(path.join(target, "jwt-secret"), "new");

    assert.deepEqual(migrateKanaDataRoot({ targetDir: target, legacyDirs: [legacy] }), []);
    assert.equal(existsSync(path.join(legacy, "jwt-secret")), true);
  });

  it("moves a WAL database with its journal files from one root", () => {
    const legacy = path.join(root, "wal", "legacy");
    const target = path.join(root, "wal", "target");
    mkdirSync(legacy, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      writeFileSync(path.join(legacy, `appstate.db${suffix}`), suffix || "db");
    }

    migrateKanaDataRoot({ targetDir: target, legacyDirs: [legacy] });

    for (const suffix of ["", "-wal", "-shm"]) {
      assert.equal(existsSync(path.join(target, `appstate.db${suffix}`)), true);
      assert.equal(existsSync(path.join(legacy, `appstate.db${suffix}`)), false);
    }
  });

  it("leaves a WAL family alone when the target already holds any part of it", () => {
    const legacy = path.join(root, "wal-orphan", "legacy");
    const target = path.join(root, "wal-orphan", "target");
    mkdirSync(legacy, { recursive: true });
    mkdirSync(target, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      writeFileSync(path.join(legacy, `appstate.db${suffix}`), suffix || "db");
    }
    writeFileSync(path.join(target, "appstate.db-wal"), "orphan");

    // The base database must not be paired with a journal from another root.
    assert.deepEqual(migrateKanaDataRoot({ targetDir: target, legacyDirs: [legacy] }), []);
    assert.equal(existsSync(path.join(target, "appstate.db")), false);
    assert.equal(existsSync(path.join(legacy, "appstate.db")), true);
  });

  it("leaves a directory holding nothing Kana wrote", () => {
    const legacy = path.join(root, "stray", "data");
    const target = path.join(root, "stray", "target");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "notes.md"), "not ours");

    assert.deepEqual(migrateKanaDataRoot({ targetDir: target, legacyDirs: [legacy] }), []);
    assert.equal(existsSync(path.join(legacy, "notes.md")), true);
    assert.equal(existsSync(target), false);
  });

  it("reports nothing when no source root exists", () => {
    assert.deepEqual(
      migrateKanaDataRoot({
        targetDir: path.join(root, "absent", "target"),
        legacyDirs: [path.join(root, "absent", "legacy")],
      }),
      [],
    );
  });
});

describe("migration gating", () => {
  it("moves data only when Kana resolved its own default root", () => {
    const operatorRoot: NodeJS.ProcessEnv = { ...process.env, KANA_DATA_DIR: "/var/lib/kana" };
    assert.equal(kanaMovesLegacyData(operatorRoot), false);
    const blank: NodeJS.ProcessEnv = { ...process.env, KANA_DATA_DIR: "  " };
    assert.equal(kanaMovesLegacyData(blank), true);
    const defaulted: NodeJS.ProcessEnv = { ...process.env };
    delete defaulted.KANA_DATA_DIR;
    assert.equal(kanaMovesLegacyData(defaulted), true);
  });

  it("moves an earlier home root once per process", () => {
    const home = mkdtempSync(path.join(tmpdir(), "kana-migrate-home-"));
    const cwd = mkdtempSync(path.join(tmpdir(), "kana-migrate-cwd-"));
    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const legacy = path.join(home, ".local", "share", "kana");
      mkdirSync(path.join(legacy, "voices"), { recursive: true });
      writeFileSync(path.join(legacy, "config.json"), '{"tts":{"provider":"pollinations"}}');
      writeFileSync(path.join(legacy, "voices", "haru.json"), "{}");

      const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
      delete environment.KANA_DATA_DIR;
      delete environment.XDG_DATA_HOME;

      const moved = ensureKanaDataRootMigrated(environment);

      assert.deepEqual(moved.sort(), ["config.json", "voices"]);
      assert.equal(
        existsSync(path.join(home, ".kana", "config.json")),
        true,
      );
      assert.equal(existsSync(path.join(home, ".kana", "voices", "haru.json")), true);
      assert.equal(existsSync(legacy), false);
      // Later calls are a no-op: the second call has nothing left to move.
      assert.deepEqual(ensureKanaDataRootMigrated(environment), []);
    } finally {
      process.chdir(previousCwd);
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("legacy data file migration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kana-data-dir-test-"));
  const targetDir = path.join(root, "target");
  const legacyCwdData = path.join(root, "legacy-cwd", "data");
  const legacyHomeKana = path.join(root, "legacy-home", ".kana");

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("moves a legacy file into the target directory and removes the original", () => {
    mkdirSync(legacyCwdData, { recursive: true });
    writeFileSync(path.join(legacyCwdData, "auth.json"), "{}");
    assert.equal(
      migrateLegacyKanaFile("auth.json", targetDir, [legacyCwdData, legacyHomeKana]),
      true,
    );
    assert.equal(
      migrateLegacyKanaFile("auth.json", targetDir, [legacyCwdData, legacyHomeKana]),
      false,
    );
  });

  it("never overwrites an existing target file", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "jwt-secret"), "new");
    mkdirSync(legacyHomeKana, { recursive: true });
    writeFileSync(path.join(legacyHomeKana, "jwt-secret"), "old");
    assert.equal(
      migrateLegacyKanaFile("jwt-secret", targetDir, [legacyHomeKana]),
      false,
    );
  });

  it("moves a WAL-mode database together with its journal files", () => {
    const legacy = path.join(root, "legacy-wal");
    const target = path.join(root, "target-wal");
    mkdirSync(legacy, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      writeFileSync(path.join(legacy, `appstate.db${suffix}`), suffix || "db");
    }
    assert.equal(migrateLegacyKanaFile("appstate.db", target, [legacy]), true);
    for (const suffix of ["", "-wal", "-shm"]) {
      assert.equal(existsSync(path.join(target, `appstate.db${suffix}`)), true);
      assert.equal(existsSync(path.join(legacy, `appstate.db${suffix}`)), false);
    }
  });

  it("reports no migration when no legacy file exists", () => {
    assert.equal(migrateLegacyKanaFile("missing.file", targetDir, [legacyHomeKana]), false);
  });
});
