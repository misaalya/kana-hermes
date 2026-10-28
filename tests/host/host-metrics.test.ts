import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cpuPercent,
  formatBytes,
  formatDuration,
  percentUsed,
} from "@/lib/host/host-metrics";

describe("host metrics", () => {
  it("derives CPU utilisation only once a sample delta exists", () => {
    assert.equal(cpuPercent(null, { idle: 100, total: 400 }), null);
    // Half of the 200 new ticks were idle.
    assert.equal(cpuPercent({ idle: 100, total: 400 }, { idle: 200, total: 600 }), 50);
    assert.equal(cpuPercent({ idle: 100, total: 400 }, { idle: 100, total: 400 }), null);
  });

  it("clamps memory and disk usage into 0-100", () => {
    assert.equal(Math.round(percentUsed(16, 4)), 75);
    assert.equal(percentUsed(0, 0), 0);
    assert.equal(percentUsed(10, -5), 100);
    assert.equal(percentUsed(10, 20), 0);
  });

  it("formats bytes across units", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(8 * 1024 ** 3), "8.0 GB");
    assert.equal(formatBytes(80 * 1024 ** 3), "80.0 GB");
    assert.equal(formatBytes(2 * 1024 ** 4), "2.0 TB");
  });

  it("formats uptime by its largest useful units", () => {
    assert.equal(formatDuration(59), "0m");
    assert.equal(formatDuration(3 * 3600 + 4 * 60), "3h 4m");
    assert.equal(formatDuration(2 * 86_400 + 5 * 3600), "2d 5h");
  });
});
