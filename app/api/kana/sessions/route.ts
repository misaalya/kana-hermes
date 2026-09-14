import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { hermesRpc } from "@/lib/server/hermes-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_LIST_LIMIT = 100;

type HermesSessionRow = {
  id: string;
  title?: string;
  preview?: string;
  started_at?: number;
  last_active?: number;
  message_count?: number;
  source?: string;
};

/**
 * GET /api/kana/sessions
 *
 * Lists Kana-originated Hermes sessions straight from the Hermes state DB
 * (session.list filtered to source === "kana"). This is the cross-browser
 * directory: a conversation created in another browser shows up here even
 * though this browser has no local IndexedDB record for it yet.
 */
export const GET = withSession(async () => {
  try {
    // The bridge discovers or re-discovers an externally started
    // `hermes serve` itself when it has no working connection.
    const result = (await hermesRpc("session.list", { limit: SESSION_LIST_LIMIT })) as {
      sessions?: HermesSessionRow[];
    };
    const sessions = (result.sessions ?? [])
      .filter((row) => (row.source ?? "").toLowerCase() === "kana")
      .map((row) => ({
        hermesSessionKey: row.id,
        title: row.title || "Untitled",
        preview: row.preview || "",
        messageCount: row.message_count ?? 0,
        startedAt: row.started_at ?? 0,
        lastActive: row.last_active ?? row.started_at ?? 0,
      }));
    return Response.json({ sessions }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 502);
  }
});
