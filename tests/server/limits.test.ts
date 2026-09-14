import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MAX_ATTACHMENT_REQUEST_BYTES,
  MAX_REQUEST_BODY_BYTES,
  MAX_VOICE_REQUEST_BYTES,
} from "@/lib/limits";

describe("request size limits", () => {
  it("keeps every route limit inside the proxy buffer, which truncates silently", () => {
    assert.ok(MAX_ATTACHMENT_REQUEST_BYTES <= MAX_REQUEST_BODY_BYTES);
    assert.ok(MAX_VOICE_REQUEST_BYTES <= MAX_REQUEST_BODY_BYTES);
  });

  it("documents the same Nginx body limit", () => {
    const documented = `${MAX_REQUEST_BODY_BYTES / (1024 * 1024)}m`;
    const guide = readFileSync("docs/SUPPORTED_ENVIRONMENT.md", "utf8");
    const values = [...guide.matchAll(/client_max_body_size\s+(\S+);/g)].map((match) => match[1]);
    assert.ok(values.length > 0, "the Nginx example sets client_max_body_size");
    for (const value of values) assert.equal(value, documented);
  });

  it("documents a proxy Host header that keeps the port for the origin guard", () => {
    for (const file of ["docs/SUPPORTED_ENVIRONMENT.md", "docs/SECURITY.md"]) {
      const guide = readFileSync(file, "utf8");
      const hosts = [...guide.matchAll(/proxy_set_header\s+Host\s+(\S+);/g)].map((match) => match[1]);
      assert.ok(hosts.length > 0, `${file} sets the proxied Host header`);
      // `$host` drops a non-default port, which the origin guard would reject.
      for (const value of hosts) assert.equal(value, "$http_host", file);
    }
  });
});
