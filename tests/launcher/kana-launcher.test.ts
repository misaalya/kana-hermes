import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import defaultConfig from "../../config/default-config.json";

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
  it("creates an owner-only editable JSON config without replacing user edits", () => {
    withFreshHome((environment, home) => {
      const dataDirectory = path.join(home, ".local", "share", "kana");
      const configFile = path.join(dataDirectory, "config.json");
      const first = spawnSync(process.execPath, [launcher, "config"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
      });

      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, new RegExp(configFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), defaultConfig);
      assert.equal(statSync(configFile).mode & 0o777, 0o600);

      writeFileSync(configFile, '{"deployment":{"mode":"deployment"}}\n');
      const second = spawnSync(process.execPath, [launcher, "config"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
      });
      assert.equal(second.status, 0, second.stderr);
      assert.equal(
        readFileSync(configFile, "utf8"),
        '{"deployment":{"mode":"deployment"}}\n',
      );
    });
  });

  it("runs doctor on a fresh install without invoking optional setup", () => {
    withFreshHome((environment, home) => {
      const result = spawnSync(process.execPath, [launcher, "doctor"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Kana doctor/);
      assert.match(result.stdout, /Access password\s+not set/);
      assert.doesNotMatch(result.stdout, /optional voice setup/i);
      assert.equal(
        existsSync(path.join(home, ".config", "kana", "launcher.json")),
        false,
      );
    });
  });

  it("discovers Hermes from every PATH directory", () => {
    withFreshHome((environment, home) => {
      const customBin = path.join(home, "tools", "bin");
      const hermes = path.join(customBin, "hermes");
      mkdirSync(customBin, { recursive: true });
      writeFileSync(hermes, "#!/bin/sh\nexit 0\n");
      chmodSync(hermes, 0o755);
      const result = spawnSync(process.execPath, [launcher, "doctor"], {
        cwd: root,
        env: {
          ...environment,
          PATH: `${customBin}${path.delimiter}${environment.PATH ?? ""}`,
        },
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      // Paths under the user's home are shown with "~".
      assert.ok(hermes.startsWith(home));
      assert.match(result.stdout, new RegExp(`Hermes\\s+~${hermes.slice(home.length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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

  it("requires a password before starting and never falls back to a default", () => {
    withFreshHome((environment) => {
      const result = spawnSync(process.execPath, [launcher, "serve", "--port", "3999"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
        input: "",
      });
      assert.notEqual(result.status, 0);
      const output = `${result.stdout}\n${result.stderr}`;
      // A checkout without a standalone build stops earlier with a build hint.
      assert.match(output, /No access password is set|npm run package:local/);
      assert.doesNotMatch(output, /chankana123/);
    });
  });

  it("sets the password non-interactively from stdin in the shared record format", () => {
    withFreshHome((environment, home) => {
      const tooShort = spawnSync(process.execPath, [launcher, "password", "--stdin"], {
        cwd: root, env: environment, encoding: "utf8", input: "short\n",
      });
      assert.notEqual(tooShort.status, 0);
      assert.match(tooShort.stderr, /at least 8/);

      const saved = spawnSync(process.execPath, [launcher, "password", "--stdin"], {
        cwd: root, env: environment, encoding: "utf8", input: "launcher-secret\n",
      });
      assert.equal(saved.status, 0, saved.stderr);
      assert.doesNotMatch(`${saved.stdout}${saved.stderr}`, /ExperimentalWarning/);

      const database = new DatabaseSync(path.join(home, ".local", "share", "kana", "appstate.db"), { readOnly: true });
      const row = database.prepare("SELECT value FROM app_state WHERE key = 'auth.password'").get() as { value: string };
      database.close();
      const record = JSON.parse(row.value) as { passwordHash: string; sessionVersion: string };
      assert.match(record.passwordHash, /^scrypt\$/);
      assert.ok(record.sessionVersion.length > 0);

      const doctor = spawnSync(process.execPath, [launcher, "doctor"], { cwd: root, env: environment, encoding: "utf8" });
      assert.match(doctor.stdout, /Access password\s+set/);
    });
  });

  it("rejects unknown commands and options with a usage hint", () => {
    for (const args of [["bogus"], ["--bogus"]]) {
      const result = spawnSync(process.execPath, [launcher, ...args], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /kana --help/);
    }
  });
});
