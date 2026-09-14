import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRequestOrigin, trustedOriginsFromEnv } from "@/lib/server/request-origin";

function check(method: string, headers: Record<string, string>, trusted: string[] = []) {
  return checkRequestOrigin({ method, headers: new Headers(headers) }, trusted);
}

describe("CSRF origin guard", () => {
  it("never blocks safe methods", () => {
    assert.equal(check("GET", { origin: "https://evil.example", host: "kana.example" }).allowed, true);
    assert.equal(check("HEAD", {}).allowed, true);
  });

  it("allows same-origin writes on localhost and behind a TLS proxy", () => {
    assert.equal(check("POST", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }).allowed, true);
    assert.equal(check("POST", { origin: "http://localhost:3000", host: "localhost:3000" }).allowed, true);
    assert.equal(check("PUT", { origin: "https://kana.example", host: "kana.example" }).allowed, true);
    assert.equal(check("POST", { origin: "https://kana.example", host: "kana.example:443" }).allowed, true);
    assert.equal(
      check("POST", { origin: "https://kana.example", host: "127.0.0.1:3000", "x-forwarded-host": "kana.example" }).allowed,
      true,
    );
  });

  it("needs the port in Host when the public origin uses a non-default port", () => {
    const origin = "https://kana.example:8443";
    // Nginx `$http_host` keeps the port the browser used.
    assert.equal(check("POST", { origin, host: "kana.example:8443" }).allowed, true);
    // Nginx `$host` strips it, which cannot match the origin.
    assert.equal(check("POST", { origin, host: "kana.example" }).allowed, false);
  });

  it("rejects another app on the same host but a different port (same-site, cross-origin)", () => {
    const result = check("POST", { origin: "http://localhost:5173", host: "localhost:3000" });
    assert.equal(result.allowed, false);
  });

  it("rejects sibling subdomains, opaque origins, and cross-site fetch metadata", () => {
    assert.equal(check("POST", { origin: "https://blog.example", host: "kana.example" }).allowed, false);
    assert.equal(check("DELETE", { origin: "null", host: "kana.example" }).allowed, false);
    assert.equal(check("POST", { "sec-fetch-site": "cross-site", host: "kana.example" }).allowed, false);
    assert.equal(check("POST", { "sec-fetch-site": "same-site", host: "kana.example" }).allowed, false);
    assert.equal(check("POST", { origin: "not a url", host: "kana.example" }).allowed, false);
  });

  it("allows non-browser clients that send no browser metadata at all", () => {
    assert.equal(check("POST", { host: "127.0.0.1:3000" }).allowed, true);
    assert.equal(check("POST", { "sec-fetch-site": "same-origin" }).allowed, true);
  });

  it("honours explicitly trusted origins from the environment", () => {
    const trusted = trustedOriginsFromEnv({ KANA_TRUSTED_ORIGINS: "https://kana.example:8443/, nonsense" } as unknown as NodeJS.ProcessEnv);
    assert.deepEqual(trusted, ["https://kana.example:8443"]);
    assert.equal(check("POST", { origin: "https://kana.example:8443", host: "internal:3000" }, trusted).allowed, true);
  });
});
