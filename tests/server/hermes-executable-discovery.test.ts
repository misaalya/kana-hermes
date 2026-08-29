import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { hermesExecutableCandidates } from "@/lib/server/local-hermes-runtime";

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

  it("covers official user, source-venv, custom install, and Termux locations", () => {
    const candidates = hermesExecutableCandidates({
      home: "/home/kana",
      hermesHome: "/state/hermes",
      installDirectory: "/opt/hermes-agent",
      prefix: "/data/data/com.termux/files/usr",
      operatingSystem: "linux",
    });

    for (const candidate of [
      "/state/hermes/bin/hermes",
      "/state/hermes/venv/bin/hermes",
      "/state/hermes/hermes-agent/venv/bin/hermes",
      "/opt/hermes-agent/venv/bin/hermes",
      "/home/kana/.local/bin/hermes",
      "/data/data/com.termux/files/usr/bin/hermes",
      "/usr/local/bin/hermes",
    ]) {
      assert.ok(candidates.includes(candidate), `missing ${candidate}`);
    }
  });
});
