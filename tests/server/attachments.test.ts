import assert from "node:assert/strict";
import { it } from "node:test";
import { validateAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/agent/attachments";
import { POST } from "@/app/api/hermes/attachments/route";

it("rejects path injection, control characters and malformed upload data", () => {
  for (const name of ["../private.txt", "a/b", "a\\b", "..", "", "bad\nname"]) {
    assert.throws(() => validateAttachment({ name, dataUrl: "data:text/plain;base64,aGk=" }));
  }
  for (const dataUrl of ["file:///etc/passwd", "data:text/plain,hello", "data:text/plain;base64,%%%", "data:text/plain;base64,a", "data:text/plain;base64,"]) {
    assert.throws(() => validateAttachment({ name: "test.txt", dataUrl }));
  }
  assert.equal(validateAttachment({ name: "日本語 notes.txt", dataUrl: "data:text/plain;base64,aGk=" }).name, "日本語 notes.txt");
});

it("allows the exact byte limit and rejects an oversized decoded payload", () => {
  const encode = (bytes: number) => ({ name: "test.bin", dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(bytes).toString("base64")}` });
  assert.doesNotThrow(() => validateAttachment(encode(MAX_ATTACHMENT_BYTES)));
  assert.throws(() => validateAttachment(encode(MAX_ATTACHMENT_BYTES + 1)), /10 MiB/);
});

it("rejects unauthenticated uploads before parsing or contacting Hermes", async () => {
  const response = await POST(new Request("http://localhost/api/hermes/attachments", { method: "POST", body: "invalid" }));
  assert.equal(response.status, 401);
});
