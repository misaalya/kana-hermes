import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  HERMES_DEFAULT_PORT,
  hermesExecutableCandidates,
  parseHermesServeArgv,
  readHermesProcessToken,
  scanHermesServeProcesses,
} from "@/shared/hermes-discovery.mjs";

describe("Hermes executable discovery", () => {
  it("prefers explicit and JSON paths before scanning the complete PATH", () => {
    const candidates = hermesExecutableCandidates({
      explicit: "/operator/hermes",
      configured: "/config/hermes",
      pathValue: ["/custom/first", "/custom/second"].join(path.delimiter),
      home: "/home/kana",
      operatingSystem: "linux",
    });

    assert.deepEqual(candidates.slice(0, 4), [
      "/operator/hermes",
      "/config/hermes",
      "/custom/first/hermes",
      "/custom/second/hermes",
    ]);
  });

  it("covers the official installer, pip/uv/pipx, Nix, Homebrew, and Termux layouts", () => {
    const candidates = hermesExecutableCandidates({
      home: "/home/kana",
      hermesHome: "/state/hermes",
      installDirectory: "/opt/hermes-agent",
      prefix: "/data/data/com.termux/files/usr",
      xdgBinHome: "/home/kana/bin",
      operatingSystem: "linux",
    });

    for (const candidate of [
      // Official installer: explicit dir, user layout, root FHS layout.
      "/opt/hermes-agent/venv/bin/hermes",
      "/home/kana/.local/bin/hermes",
      "/state/hermes/hermes-agent/venv/bin/hermes",
      "/usr/local/bin/hermes",
      "/usr/local/lib/hermes-agent/venv/bin/hermes",
      // uv tool / pipx with XDG_BIN_HOME, Termux, Nix, Homebrew on Linux.
      "/home/kana/bin/hermes",
      "/data/data/com.termux/files/usr/bin/hermes",
      "/home/kana/.nix-profile/bin/hermes",
      "/run/current-system/sw/bin/hermes",
      "/home/linuxbrew/.linuxbrew/bin/hermes",
    ]) {
      assert.ok(candidates.includes(candidate), `missing ${candidate}`);
    }
  });
});

describe("Hermes serve process recognition", () => {
  it("recognises the shapes Hermes itself recognises", () => {
    assert.deepEqual(
      parseHermesServeArgv(["/home/u/.hermes/hermes-agent/venv/bin/python", "/home/u/.hermes/hermes-agent/hermes", "serve", "--host", "127.0.0.1", "--port", "9200"]),
      { port: 9200, host: "127.0.0.1" },
    );
    assert.deepEqual(parseHermesServeArgv(["/usr/bin/python3", "-m", "hermes_cli.main", "serve", "--port=9300"]), { port: 9300, host: "127.0.0.1" });
    assert.deepEqual(parseHermesServeArgv(["/usr/local/bin/hermes", "serve"]), { port: HERMES_DEFAULT_PORT, host: "127.0.0.1" });
  });

  it("ignores other commands, shells mentioning Hermes, ephemeral ports, and public binds", () => {
    assert.equal(parseHermesServeArgv(["/usr/local/bin/hermes", "gateway"]), null);
    assert.equal(parseHermesServeArgv(["/bin/bash", "-c", "pgrep -af 'hermes serve --port 9119'"]), null);
    assert.equal(parseHermesServeArgv(["hermes", "serve", "--host", "127.0.0.1", "--port", "0"]), null);
    assert.equal(parseHermesServeArgv(["hermes", "serve", "--host", "0.0.0.0", "--port", "9119"]), null);
  });

  const procRoot = mkdtempSync(path.join(tmpdir(), "kana-proc-"));
  after(() => rmSync(procRoot, { recursive: true, force: true }));

  function fakeProcess(pid: number, argv: string[], environ?: Record<string, string>) {
    const directory = path.join(procRoot, String(pid));
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "cmdline"), `${argv.join("\0")}\0`);
    if (environ) {
      writeFileSync(
        path.join(directory, "environ"),
        Object.entries(environ).map(([key, value]) => `${key}=${value}`).join("\0"),
      );
    }
  }

  it("scans /proc without pgrep and reads the gateway token", async () => {
    fakeProcess(4100, ["/usr/bin/python3", "/home/u/.local/bin/hermes", "serve", "--port", "9119"], {
      PATH: "/usr/bin",
      HERMES_DASHBOARD_SESSION_TOKEN: "secret-token",
    });
    fakeProcess(4200, ["/usr/bin/vim", "notes.md"]);
    fakeProcess(4300, ["/usr/local/bin/hermes", "serve", "--port", "9555"]);
    mkdirSync(path.join(procRoot, "self"), { recursive: true });

    const found = await scanHermesServeProcesses(procRoot);
    assert.deepEqual(found.map(({ pid, port }) => ({ pid, port })), [
      { pid: 4100, port: 9119 },
      { pid: 4300, port: 9555 },
    ]);
    assert.equal(await readHermesProcessToken(4100, procRoot), "secret-token");
    assert.equal(await readHermesProcessToken(4300, procRoot), null, "unreadable environ yields no token");
    assert.deepEqual(await scanHermesServeProcesses(path.join(procRoot, "missing")), []);
  });
});
