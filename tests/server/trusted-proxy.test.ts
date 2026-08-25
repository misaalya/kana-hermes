import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  TRUSTED_PROXY_HEADER,
  isLoopbackHostname,
  isLoopbackPeer,
  isLoopbackRequest,
  trustedProxySecretMatches,
} from "@/lib/server/auth/loopback";

const SECRET = "unit-test-proxy-secret";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://kana.example/api/local-runtime/hermes", { headers });
}

after(() => {
  delete process.env.KANA_TRUSTED_PROXY_SECRET;
});

describe("loopback hostname parsing", () => {
  it("recognizes loopback forms with ports, brackets, and IPv4-mapped IPv6", () => {
    assert.equal(isLoopbackHostname("127.0.0.1:3000"), true);
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLoopbackHostname("[::1]:8080"), true);
    assert.equal(isLoopbackHostname("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackHostname("kana.example"), false);
    assert.equal(isLoopbackHostname(null), false);
  });
});

describe("trusted proxy secret matching", () => {
  it("accepts only the exact configured value", () => {
    assert.equal(trustedProxySecretMatches(SECRET, SECRET), true);
    // Headers.get() hands back trimmed values; anything else must not match.
    assert.equal(trustedProxySecretMatches(`${SECRET} `, SECRET), false);
    assert.equal(trustedProxySecretMatches(`${SECRET}-extra`, SECRET), false);
    assert.equal(trustedProxySecretMatches(SECRET.slice(0, -1), SECRET), false);
    assert.equal(trustedProxySecretMatches("", SECRET), false);
    assert.equal(trustedProxySecretMatches(SECRET, ""), false);
    assert.equal(trustedProxySecretMatches(null, SECRET), false);
  });
});

describe("isLoopbackRequest trust model", () => {
  it("ignores the header and uses hostname evidence when no secret is set", () => {
    delete process.env.KANA_TRUSTED_PROXY_SECRET;
    assert.equal(
      isLoopbackRequest(
        requestWithHeaders({ host: "kana.example", [TRUSTED_PROXY_HEADER]: "anything" }),
      ),
      false,
    );
    assert.equal(isLoopbackRequest(requestWithHeaders({ host: "127.0.0.1:3000" })), true);
  });

  it("trusts a matching secret header even for a public Host", () => {
    process.env.KANA_TRUSTED_PROXY_SECRET = SECRET;
    assert.equal(
      isLoopbackRequest(
        requestWithHeaders({ host: "kana.example", [TRUSTED_PROXY_HEADER]: SECRET }),
      ),
      true,
    );
  });

  it("rejects a wrong or missing secret header regardless of loopback-looking Host", () => {
    process.env.KANA_TRUSTED_PROXY_SECRET = SECRET;
    const spoofedHost = { host: "127.0.0.1" };
    assert.equal(
      isLoopbackRequest(requestWithHeaders({ ...spoofedHost, [TRUSTED_PROXY_HEADER]: "wrong" })),
      false,
    );
    assert.equal(isLoopbackRequest(requestWithHeaders(spoofedHost)), false);
  });

  it("still applies Origin evidence in the no-secret fallback", () => {
    delete process.env.KANA_TRUSTED_PROXY_SECRET;
    assert.equal(
      isLoopbackPeer({ host: "localhost:3000", origin: "https://evil.example" }),
      false,
    );
    assert.equal(
      isLoopbackPeer({ host: "localhost:3000", origin: "http://localhost:3000" }),
      true,
    );
  });
});
