import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  KANA_DATA_DIR_ENV,
  migrateLegacyKanaFile,
  resolveKanaDataDir,
  resolveKanaDataDirFrom,
} from "@/lib/server/data-dir";

after(() => {
  delete process.env[KANA_DATA_DIR_ENV];
});

describe("data dir resolution precedence", () => {
  it("prefers an explicit KANA_DATA_DIR over every other source", () => {
    assert.equal(
      resolveKanaDataDirFrom({
        kanaDataDir: "/srv/kana-data",
        xdgDataHome: "/xdg",
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

  it("honors an absolute XDG_DATA_HOME when KANA_DATA_DIR is unset", () => {
    assert.equal(
      resolveKanaDataDirFrom({ xdgDataHome: "/xdg/data", home: "/home/kana" }),
      path.join("/xdg/data", "kana"),
    );
  });

  it("ignores a relative XDG_DATA_HOME per the XDG spec and falls back to HOME", () => {
    assert.equal(
      resolveKanaDataDirFrom({ xdgDataHome: "relative/path", home: "/home/kana" }),
      path.join("/home/kana", ".local", "share", "kana"),
    );
  });

  it("uses $HOME/.local/share/kana as the final default", () => {
    assert.equal(
      resolveKanaDataDirFrom({ home: "/home/kana" }),
      path.join("/home/kana", ".local", "share", "kana"),
    );
  });

  it("throws naming the env var when nothing is resolvable in production", () => {
    assert.throws(
      () => resolveKanaDataDirFrom({ kanaDataDir: "", xdgDataHome: "", home: "" }),
      (error: Error) => error.message.includes(KANA_DATA_DIR_ENV),
    );
  });

  it("keeps a dev-only cwd fallback instead of throwing outside production", () => {
    const resolved = resolveKanaDataDir({
      NODE_ENV: "development",
      HOME: "",
      XDG_DATA_HOME: "",
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

  it("reports no migration when no legacy file exists", () => {
    assert.equal(migrateLegacyKanaFile("missing.file", targetDir, [legacyHomeKana]), false);
  });
});
