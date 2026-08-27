import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const launcher = path.join(root, "bin", "kana.mjs");

function withFreshHome(
  run: (environment: NodeJS.ProcessEnv, home: string) => void,
): void {
  const home = mkdtempSync(path.join(tmpdir(), "kana-launcher-test-"));
  try {
    run(
      {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local", "share"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
      },
      home,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("npm launcher", () => {
  it("runs doctor on a fresh install without invoking optional setup", () => {
    withFreshHome((environment, home) => {
      const result = spawnSync(process.execPath, [launcher, "doctor"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Kana doctor/m);
      assert.doesNotMatch(result.stdout, /optional voice setup/i);
      assert.equal(
        existsSync(path.join(home, ".config", "kana", "launcher.json")),
        false,
      );
    });
  });

  it("rejects an invalid start port before launching services or setup", () => {
    withFreshHome((environment) => {
      const result = spawnSync(
        process.execPath,
        [launcher, "--no-open", "--port", "80"],
        { cwd: root, env: environment, encoding: "utf8" },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /between 1024 and 65535/);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /optional voice setup/i);
    });
  });
});
