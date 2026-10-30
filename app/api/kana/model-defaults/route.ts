import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  parseModelDefaults,
  readModelDefaults,
  writeModelDefaults,
} from "@/lib/server/model-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * GET /api/kana/model-defaults
 * The installation's default model per Hermes runtime, shared by every
 * browser that reaches this Kana server.
 */
export const GET = withSession(async () =>
  Response.json({ defaults: readModelDefaults() }, { headers: NO_STORE }),
);

/**
 * PUT /api/kana/model-defaults
 * Body: { defaults: { "<runtime id>": { provider, model } } }
 * Replaces the whole map; the settings save sends the complete draft.
 */
export const PUT = withSession(async (request) => {
  let body: { defaults?: unknown };
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  const defaults = parseModelDefaults(body.defaults);
  if (!defaults) {
    return Response.json(
      { error: "Field 'defaults' must map runtime ids to provider/model choices." },
      { status: 400, headers: NO_STORE },
    );
  }
  writeModelDefaults(defaults);
  return Response.json({ defaults }, { headers: NO_STORE });
});
