import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  addHermesModel,
  HermesModelError,
  listHermesCustomProviders,
} from "@/lib/server/hermes-model-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model management goes through Hermes's own dashboard API. Kana holds the
// credentials/cookie, strips every key and preview from the response, and
// never writes Hermes configuration itself.

const MAX_BODY_BYTES = 32 * 1024;

function errorResponse(error: unknown): Response {
  if (error instanceof HermesModelError) {
    return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  return Response.json(
    { error: "Kana could not update Hermes's model configuration." },
    { status: 502, headers: NO_STORE },
  );
}

export const GET = withSession(async () => {
  try {
    const providers = await listHermesCustomProviders();
    return Response.json({ providers }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
});

export const POST = withSession(async (request) => {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  try {
    const provider = await addHermesModel(body);
    return Response.json({ ok: true, provider }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
});
