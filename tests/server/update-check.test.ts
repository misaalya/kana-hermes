import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  compareVersions,
  describeUpdate,
  fetchLatestVersion,
  parseVersion,
  UPDATE_INSTALL_COMMAND,
} from "../../shared/update-check.mjs";

describe("update version comparison", () => {
  it("orders core versions numerically, not as strings", () => {
    assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
    assert.equal(compareVersions("0.4.1", "0.4.1"), 0);
    assert.equal(compareVersions("0.4.0", "0.4.1"), -1);
  });

  it("ranks a prerelease below its release and orders prerelease parts", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
    assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
    assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  });

  it("accepts one leading v and compares it like the plain version", () => {
    assert.deepEqual(parseVersion("v1.2.3"), parseVersion("1.2.3"));
    assert.equal(compareVersions("v1.2.4", "1.2.3"), 1);
    assert.deepEqual(describeUpdate("0.4.1", "v0.5.0"), {
      currentVersion: "0.4.1",
      latestVersion: "v0.5.0",
      installCommand: UPDATE_INSTALL_COMMAND,
    });
  });

  it("orders numeric prerelease identifiers without float precision loss", () => {
    assert.equal(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992"), 1);
    assert.equal(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740993"), 0);
    // Leading zeroes are numbers, not strings.
    assert.equal(compareVersions("1.0.0-09", "1.0.0-10"), -1);
  });

  it("ignores build metadata and keeps prerelease ordering", () => {
    assert.equal(compareVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
    assert.equal(compareVersions("1.0.0+build.7", "1.0.0"), 0);
    assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta"), 1);
    assert.equal(compareVersions("1.0.0-beta", "1.0.0-alpha"), 1);
    assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha"), 1);
  });

  it("treats unparseable input as no difference", () => {
    assert.equal(parseVersion("latest"), null);
    assert.equal(compareVersions("garbage", "0.4.1"), 0);
  });

  it("reports an update only when the registry version is newer", () => {
    assert.deepEqual(describeUpdate("0.4.0", "0.4.1"), {
      currentVersion: "0.4.0",
      latestVersion: "0.4.1",
      installCommand: UPDATE_INSTALL_COMMAND,
    });
    assert.equal(describeUpdate("0.4.1", "0.4.1"), null);
    assert.equal(describeUpdate("0.4.1", null), null);
    // An unparseable registry version is never an update.
    assert.equal(describeUpdate("0.4.1", "latest"), null);
  });
});

describe("registry lookup", () => {
  let server: Server;
  let url: string;
  let mode = "ok";
  const timers = new Set<ReturnType<typeof setInterval>>();

  before(async () => {
    server = createServer((request, response) => {
      if (mode === "ok") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: "0.4.1" }));
      } else if (mode === "bad-json") {
        response.writeHead(200);
        response.end("not json");
      } else if (mode === "not-found") {
        response.writeHead(404);
        response.end("{}");
      } else if (mode === "not-a-string") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: 5 }));
      } else if (mode === "v-prefix") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: "v0.5.0" }));
      } else if (mode === "redirect") {
        response.writeHead(302, { location: "/elsewhere" });
        response.end();
      } else if (mode === "oversized") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: "0.4.1", pad: "x".repeat(80 * 1024) }));
      } else if (mode === "trickle") {
        response.writeHead(200, { "content-type": "application/json" });
        const timer = setInterval(() => response.write(" "), 50);
        timers.add(timer);
        request.on("close", () => {
          clearInterval(timer);
          timers.delete(timer);
        });
        return;
      } else {
        // Never answers, so the timeout is what ends the request.
        return;
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/latest`;
  });

  after(async () => {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns the registry version", { timeout: 2_000 }, async () => {
    mode = "ok";
    assert.equal(await fetchLatestVersion({ url }), "0.4.1");
  });

  it("strips one leading v from the reported version", { timeout: 2_000 }, async () => {
    mode = "v-prefix";
    assert.equal(await fetchLatestVersion({ url }), "0.5.0");
  });

  it("returns null for a bad body, a wrong type, or a non-200 status", { timeout: 2_000 }, async () => {
    mode = "bad-json";
    assert.equal(await fetchLatestVersion({ url }), null);
    mode = "not-a-string";
    assert.equal(await fetchLatestVersion({ url }), null);
    mode = "not-found";
    assert.equal(await fetchLatestVersion({ url }), null);
  });

  it("does not follow a redirect", { timeout: 2_000 }, async () => {
    mode = "redirect";
    assert.equal(await fetchLatestVersion({ url }), null);
  });

  it("gives up on an oversized body instead of buffering it", { timeout: 2_000 }, async () => {
    mode = "oversized";
    assert.equal(await fetchLatestVersion({ url }), null);
  });

  it("ends an idle request when the deadline passes", { timeout: 2_000 }, async () => {
    mode = "hang";
    assert.equal(await fetchLatestVersion({ url, timeoutMs: 100 }), null);
  });

  it("ends a request that trickles bytes forever (absolute deadline)", { timeout: 2_000 }, async () => {
    mode = "trickle";
    const started = Date.now();
    assert.equal(await fetchLatestVersion({ url, timeoutMs: 300 }), null);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1_000, `deadline should fire well under a second, took ${elapsed}ms`);
  });

  it("returns null when nothing listens", { timeout: 2_000 }, async () => {
    assert.equal(await fetchLatestVersion({ url: "http://127.0.0.1:1/latest", timeoutMs: 500 }), null);
  });

  it("returns null instead of throwing for an invalid or unsupported URL", { timeout: 2_000 }, async () => {
    assert.equal(await fetchLatestVersion({ url: "not a url" }), null);
    assert.equal(await fetchLatestVersion({ url: "ftp://example.com/latest" }), null);
  });
});