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
        // The assertions read the doctor's own text, and a caller that forces
        // colour would put escape sequences inside that text: `node --test`
        // sets FORCE_COLOR while it colorizes its reporter, and a real terminal
        // does the same. NO_COLOR outranks FORCE_COLOR in the launcher, so the
        // text these tests match is identical at a terminal and in a pipe.
        NO_COLOR: "1",
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
      const dataDirectory = path.join(home, ".kana");
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

  it("moves an earlier install's data root into ~/.kana on the next start", () => {
      withFreshHome((environment, home) => {
        const legacy = path.join(home, ".local", "share", "kana");
        mkdirSync(path.join(legacy, "voices"), { recursive: true });
        writeFileSync(path.join(legacy, "config.json"), '{"deployment":{"mode":"deployment"}}\n');
        writeFileSync(path.join(legacy, "auth.json"), "{}\n");

        const result = spawnSync(process.execPath, [launcher, "doctor"], {
          cwd: root,
          env: environment,
          encoding: "utf8",
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Moved config\.json from /);
        assert.equal(
          readFileSync(path.join(home, ".kana", "config.json"), "utf8"),
          '{"deployment":{"mode":"deployment"}}\n',
        );
        assert.equal(existsSync(path.join(home, ".kana", "auth.json")), true);
        assert.equal(existsSync(path.join(home, ".kana", "voices")), true);
        assert.equal(existsSync(legacy), false);
      });
    });

    it("leaves an operator-set data root and its earlier root alone", () => {
      withFreshHome((environment, home) => {
        const legacy = path.join(home, ".local", "share", "kana");
        mkdirSync(legacy, { recursive: true });
        writeFileSync(path.join(legacy, "config.json"), "{}\n");

        const result = spawnSync(process.execPath, [launcher, "doctor"], {
          cwd: root,
          env: { ...environment, KANA_DATA_DIR: path.join(home, "kana-deploy") },
          encoding: "utf8",
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(existsSync(path.join(legacy, "config.json")), true);
        assert.equal(existsSync(path.join(home, ".kana")), false);
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

      const database = new DatabaseSync(path.join(home, ".kana", "appstate.db"), { readOnly: true });
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

describe("kana migrate", () => {
  /** A data root shaped like a managed deployment: marker files, a WAL family, and a voice library. */
  function managedRoot(home: string): string {
    const managed = path.join(home, "srv-data");
    mkdirSync(path.join(managed, "voices"), { recursive: true });
    writeFileSync(path.join(managed, "jwt-secret"), "session-secret\n", { mode: 0o600 });
    writeFileSync(path.join(managed, "appstate.db"), "db");
    writeFileSync(path.join(managed, "appstate.db-wal"), "wal");
    writeFileSync(path.join(managed, "voices", "kana.wav"), "wav");
    return managed;
  }

  function run(args: string[], environment: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [launcher, ...args], {
      cwd: root,
      env: environment,
      encoding: "utf8",
    });
  }

  it("copies a managed root into ~/.kana, verifies every entry, and keeps the source", () => {
    withFreshHome((environment, home) => {
      const managed = managedRoot(home);
      const result = run(["migrate", "--yes"], { ...environment, KANA_DATA_DIR: managed });

      assert.equal(result.status, 0, result.stderr);
      // The plan names every entry, with its size, before anything is written.
      assert.match(result.stdout, /Entries\s+4\b/);
      assert.match(result.stdout, /voices\s+1 file, 3 B/);
      assert.match(result.stdout, /copied and verified/);
      for (const name of ["jwt-secret", "appstate.db", "appstate.db-wal"]) {
        assert.equal(existsSync(path.join(home, ".kana", name)), true, name);
      }
      assert.equal(existsSync(path.join(home, ".kana", "voices", "kana.wav")), true);
      // A copied session secret must stay a secret.
      assert.equal(statSync(path.join(home, ".kana", "jwt-secret")).mode & 0o777, 0o600);
      // The copy leaves the source alone: deleting a data root is the operator's act.
      assert.equal(existsSync(path.join(managed, "jwt-secret")), true);
      assert.match(result.stdout, /unchanged; delete it yourself/);
      // A systemd unit belongs to the operator, so Kana only says what to change.
      assert.match(result.stdout, /KANA_DATA_DIR=/);
    });
  });

  it("moves the entries and empties the source root with --delete-source", () => {
    withFreshHome((environment, home) => {
      const managed = managedRoot(home);
      const result = run(["migrate", "--yes", "--delete-source"], {
        ...environment,
        KANA_DATA_DIR: managed,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /moved into/);
      assert.equal(readFileSync(path.join(home, ".kana", "jwt-secret"), "utf8"), "session-secret\n");
      assert.equal(readFileSync(path.join(home, ".kana", "appstate.db"), "utf8"), "db");
      assert.equal(existsSync(path.join(home, ".kana", "appstate.db-wal")), true);
      assert.equal(existsSync(managed), false);
    });
  });

  it("lists the plan and changes nothing with --dry-run", () => {
    withFreshHome((environment, home) => {
      const managed = managedRoot(home);
      const result = run(["migrate", "--dry-run"], { ...environment, KANA_DATA_DIR: managed });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /appstate\.db/);
      assert.match(result.stdout, /Dry run: nothing was changed\./);
      assert.equal(existsSync(path.join(home, ".kana")), false);
      assert.equal(existsSync(path.join(managed, "jwt-secret")), true);
    });
  });

  it("asks for a terminal or --yes before it moves anything", () => {
    withFreshHome((environment, home) => {
      const managed = managedRoot(home);
      // spawnSync pipes both streams, so this start cannot prompt for agreement.
      const result = run(["migrate"], { ...environment, KANA_DATA_DIR: managed });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /interactive terminal/);
      assert.match(result.stderr, /--yes/);
      assert.equal(existsSync(path.join(home, ".kana")), false);
    });
  });

  it("refuses a source Kana did not write, and --force takes it anyway", () => {
    withFreshHome((environment, home) => {
      const plain = path.join(home, "plain");
      mkdirSync(plain, { recursive: true });
      writeFileSync(path.join(plain, "notes.txt"), "not Kana's\n");

      const refused = run(["migrate", "--from", plain, "--yes"], environment);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /does not look like a Kana data root/);
      assert.equal(existsSync(path.join(home, ".kana")), false);

      const forced = run(["migrate", "--from", plain, "--force", "--yes"], environment);
      assert.equal(forced.status, 0, forced.stderr);
      assert.equal(readFileSync(path.join(home, ".kana", "notes.txt"), "utf8"), "not Kana's\n");
    });
  });

  it("refuses a relative source, a missing source, and overlapping roots", () => {
    withFreshHome((environment, home) => {
      const managed = managedRoot(home);
      const environmentWithRoot = { ...environment, KANA_DATA_DIR: managed };

      const relative = run(["migrate", "--from", "relative/data", "--yes"], environmentWithRoot);
      assert.equal(relative.status, 1);
      assert.match(relative.stderr, /must be an absolute path/);

      const missing = run(["migrate", "--from", path.join(home, "absent"), "--yes"], environmentWithRoot);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /not a directory/);

      const same = run(["migrate", "--to", managed, "--yes"], environmentWithRoot);
      assert.equal(same.status, 1);
      assert.match(same.stderr, /destination is the source/);

      const inside = run(["migrate", "--to", path.join(managed, "inner"), "--yes"], environmentWithRoot);
      assert.equal(inside.status, 1);
      assert.match(inside.stderr, /overlap/);

      // None of the refusals created a target or changed the source.
      assert.equal(existsSync(path.join(home, ".kana")), false);
      assert.equal(existsSync(path.join(managed, "jwt-secret")), true);
    });
  });

  it("says the default root is already in use when there is nothing to name", () => {
    withFreshHome((environment) => {
      const result = run(["migrate", "--yes"], environment);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /already uses the default data root/);
      assert.match(result.stderr, /--from/);
    });
  });
});
