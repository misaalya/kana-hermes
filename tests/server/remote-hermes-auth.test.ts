import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { remoteHermesConnection } from "@/lib/server/remote-hermes";
import { remoteDashboardJson, remoteWsTicket } from "@/lib/server/remote-hermes-auth";
import { kanaUserConfigPath } from "@/lib/server/user-config";

const root = mkdtempSync(path.join(tmpdir(), "kana-remote-auth-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const requests = { logins: 0, tickets: 0, rejectedTickets: 0 };
let server: ReturnType<typeof createServer>;
let port = 0;
let expireNextTicket = false;

async function body(request: import("node:http").IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

before(async () => {
  process.env.KANA_DATA_DIR = root;
  server = createServer(async (request, response) => {
    if (request.url === "/auth/password-login" && request.method === "POST") {
      const value = JSON.parse(await body(request)) as Record<string, unknown>;
      requests.logins += 1;
      if (value.provider !== "basic" || value.username !== "remote-user" || value.password !== "remote-pass") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "Invalid credentials" }));
        return;
      }
      response.setHeader("set-cookie", [
        "hermes_session_a=one; Path=/; HttpOnly",
        "hermes_session_b=two; Path=/; HttpOnly",
      ]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, next: "/" }));
      return;
    }
    if (request.url === "/api/system/stats" && request.method === "GET") {
      const cookie = request.headers.cookie ?? "";
      if (!cookie.includes("hermes_session_a=one")) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "Unauthorized" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ hostname: "instabox-box", cpu_percent: 12 }));
      return;
    }
    if (request.url === "/slow") {
      // Hold the request without answering, so the client deadline is what
      // decides the outcome.
      return;
    }
    if (request.url === "/api/auth/ws-ticket" && request.method === "POST") {
      requests.tickets += 1;
      const cookie = request.headers.cookie ?? "";
      if (!cookie.includes("hermes_session_a=one") || !cookie.includes("hermes_session_b=two")) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "Unauthorized" }));
        return;
      }
      if (expireNextTicket) {
        expireNextTicket = false;
        requests.rejectedTickets += 1;
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "Unauthorized" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ticket: "ticket-123", ttl_seconds: 30 }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  writeFileSync(
    kanaUserConfigPath(),
    JSON.stringify({
      hermes: {
        remote: {
          url: `ws://127.0.0.1:${port}`,
          auth: { mode: "password", username: "remote-user", password: "remote-pass" },
        },
      },
    }),
  );
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe("remote Hermes dashboard auth", () => {
  it("logs in, keeps cookies server-side, and mints a ticket", async () => {
    const connection = remoteHermesConnection();
    assert.ok(connection);
    assert.equal(await remoteWsTicket(connection), "ticket-123");
    assert.equal(requests.logins, 1);
    assert.equal(requests.tickets, 1);
    assert.equal(await remoteWsTicket(connection), "ticket-123");
    assert.equal(requests.logins, 1, "the cached cookie session is reused");
    assert.equal(requests.tickets, 2);

    const stats = await remoteDashboardJson<{ hostname: string }>(
      connection,
      "/api/system/stats",
    );
    assert.equal(stats.hostname, "instabox-box");
    assert.equal(requests.logins, 1, "dashboard reads reuse the same cookie session");
  });

  it("logs in again when the cookie session is rejected", async () => {
    const connection = remoteHermesConnection();
    assert.ok(connection);
    expireNextTicket = true;
    assert.equal(await remoteWsTicket(connection), "ticket-123");
    assert.equal(requests.logins, 2);
    assert.equal(requests.tickets, 4);
    assert.equal(requests.rejectedTickets, 1);
  });

  it("fails a stalled dashboard read instead of waiting forever", async () => {
    const connection = remoteHermesConnection();
    assert.ok(connection);
    await remoteWsTicket(connection);
    await assert.rejects(
      remoteDashboardJson(connection, "/slow", 150),
      /did not answer the dashboard request in time/,
    );
  });
});
