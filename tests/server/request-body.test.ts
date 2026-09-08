import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";

function streamedRequest(chunks: Uint8Array[], onCancel = () => {}) {
  let index = 0;
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: new ReadableStream({
      pull(controller) {
        if (index === chunks.length) controller.close();
        else controller.enqueue(chunks[index++]);
      },
      cancel: onCancel,
    }, { highWaterMark: 0 }),
    duplex: "half",
  } as RequestInit);
}

describe("bounded JSON request bodies", () => {
  it("decodes UTF-8 split across chunks at the exact byte limit", async () => {
    const value = { text: "日本語" };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const request = streamedRequest([...bytes].map((byte) => new Uint8Array([byte])));
    assert.deepEqual(await readJsonObject(request, bytes.length), value);
  });

  it("cancels oversized chunked input using bytes, not character count", async () => {
    let cancelled = false;
    const bytes = new TextEncoder().encode('{"text":"日本語"}');
    await assert.rejects(
      readJsonObject(streamedRequest([bytes, bytes], () => { cancelled = true; }), 18),
      (error: unknown) => error instanceof RequestBodyError && error.status === 413,
    );
    assert.equal(cancelled, true);
  });

  it("rejects a large declared length before pulling any input", async () => {
    let cancelled = false;
    const request = streamedRequest([], () => { cancelled = true; });
    request.headers.set("Content-Length", "1000");
    await assert.rejects(readJsonObject(request, 10), { status: 413 });
    assert.equal(cancelled, true);
  });

  it("rejects null, arrays, primitives, missing bodies and malformed JSON", async () => {
    for (const body of ["null", "[]", "42", '"text"', "{", undefined]) {
      await assert.rejects(readJsonObject(new Request("http://localhost", {
        method: "POST", body,
      }), 100), { status: 400 });
    }
  });
});
