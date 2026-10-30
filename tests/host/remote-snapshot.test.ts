import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { remoteHostSnapshot } from "@/lib/host/remote-snapshot";

describe("remote host snapshot", () => {
  it("maps Hermes system stats onto the widget contract", () => {
    const sampledAt = 1_700_000_000_000;
    const snapshot = remoteHostSnapshot(
      {
        hostname: "instabox-box",
        os: "Linux",
        os_release: "6.8.0",
        arch: "x86_64",
        cpu_count: 4,
        cpu_percent: 37,
        load_avg: [1, 0.5, 0.25],
        memory: { total: 8_000, available: 2_000 },
        disk: { total: 20_000, free: 12_000 },
        uptime_seconds: 3_600,
        process: { create_time: sampledAt / 1000 - 120, rss: 400 },
      },
      sampledAt,
      { now: sampledAt, zone: "Asia/Jakarta" },
    );

    assert.equal(snapshot.source, "remote");
    assert.equal(snapshot.hostname, "instabox-box");
    assert.equal(snapshot.platform, "Linux");
    assert.equal(snapshot.release, "6.8.0");
    assert.equal(snapshot.cpu.cores, 4);
    assert.equal(snapshot.cpu.percent, 37);
    assert.deepEqual(snapshot.load, [1, 0.5, 0.25]);
    assert.deepEqual(snapshot.memory, { total: 8_000, available: 2_000 });
    assert.deepEqual(snapshot.disk, { total: 20_000, available: 12_000 });
    assert.equal(snapshot.uptime, 3_600);
    assert.equal(snapshot.kana.uptime, 120);
    assert.equal(snapshot.kana.rss, 400);
    assert.equal(snapshot.serverTime.zone, "Asia/Jakarta");
  });

  it("leaves unavailable disk and CPU samples explicit", () => {
    const snapshot = remoteHostSnapshot(
      { hostname: "remote", memory: { total: 100, used: 60 } },
      1_700_000_000_000,
      { now: 1_700_000_000_000, zone: "UTC" },
    );
    assert.equal(snapshot.disk, null);
    assert.equal(snapshot.cpu.percent, undefined);
    assert.deepEqual(snapshot.memory, { total: 100, available: 40 });
    assert.equal(snapshot.hostname, "remote");
  });
});
