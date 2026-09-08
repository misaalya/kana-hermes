export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message);
    this.name = "RequestBodyError";
  }
}

/** Count wire bytes before decoding; Content-Length alone cannot bound chunked input. */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    void request.body?.cancel().catch(() => undefined);
    throw new RequestBodyError("Request body is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError("A JSON object is required.", 400);
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyError("Request body is too large.", 413);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    const body: unknown = JSON.parse(parts.join(""));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestBodyError("A JSON object is required.", 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("A valid JSON object is required.", 400);
  } finally {
    reader.releaseLock();
  }
}
