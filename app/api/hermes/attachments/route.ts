import { validateAttachment } from "@/lib/agent/attachments";
import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { hermesRpc } from "@/lib/server/hermes-bridge";
import { readJsonObject } from "@/lib/server/request-body";
import { MAX_ATTACHMENT_REQUEST_BYTES } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH_TIMEOUT_MS = 120_000;
const MAX_SESSION_ID_LENGTH = 256;

export const POST = withSession(async (request) => {
  let attachment;
  let sessionId;
  try {
    const body = await readJsonObject(request, MAX_ATTACHMENT_REQUEST_BYTES);
    if (
      typeof body.session_id !== "string" ||
      !body.session_id.trim() ||
      body.session_id.length > MAX_SESSION_ID_LENGTH
    ) {
      throw new Error("A Hermes session is required.");
    }
    sessionId = body.session_id;
    attachment = validateAttachment(body);
  } catch (error) {
    return jsonError(error);
  }
  try {
    // Only uploaded bytes, never a client-supplied server filesystem path.
    const result = await hermesRpc(
      "file.attach",
      { session_id: sessionId, name: attachment.name, data_url: attachment.dataUrl },
      ATTACH_TIMEOUT_MS,
    );
    return Response.json({ result }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 502);
  }
});
