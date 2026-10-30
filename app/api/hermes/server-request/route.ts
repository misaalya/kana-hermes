import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  answerHermesServerRequest,
  type HermesServerResponse,
} from "@/lib/server/hermes-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hermes 0.22+ asks the browser questions as server-to-client JSON-RPC
// requests. The bridge forwards them over SSE; this route carries the one
// response frame back. Only an id the gateway actually asked about is accepted.

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const POST = withSession(async (request) => {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!REQUEST_ID.test(id)) {
    return Response.json({ error: "A server request id is required." }, { status: 400, headers: NO_STORE });
  }
  let response: HermesServerResponse;
  if (isRecord(body.error)) {
    const code = typeof body.error.code === "number" && Number.isInteger(body.error.code) ? body.error.code : -32603;
    const message =
      typeof body.error.message === "string" && body.error.message.trim()
        ? body.error.message.slice(0, 500)
        : "The request could not be answered.";
    response = { error: { code, message } };
  } else if (isRecord(body.result)) {
    response = { result: body.result };
  } else {
    return Response.json({ error: "A result object is required." }, { status: 400, headers: NO_STORE });
  }
  const outcome = answerHermesServerRequest(id, response);
  if (outcome === "unknown") {
    return Response.json(
      { error: "This Hermes request is no longer open." },
      { status: 409, headers: NO_STORE },
    );
  }
  if (outcome === "disconnected") {
    return Response.json(
      { error: "Hermes gateway disconnected." },
      { status: 502, headers: NO_STORE },
    );
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
});
