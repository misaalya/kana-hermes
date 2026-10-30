import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { hermesRpc } from "@/lib/server/hermes-bridge";
import { rewriteMediaTags } from "@/lib/server/media-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_LIST_LIMIT = 100;
// The directory read gates the connection screen: a restarted or paused remote
// can leave a half-open gateway socket, so this read fails fast and retires
// that socket instead of waiting out the long RPC timeout.
const SESSION_LIST_TIMEOUT_MS = 10_000;

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
    const result = (await hermesRpc(
      "session.list",
      { limit: SESSION_LIST_LIMIT },
      SESSION_LIST_TIMEOUT_MS,
      { retireOnTimeout: true },
    )) as {
      sessions?: HermesSessionRow[];
    };
    const sessions = (result.sessions ?? [])
      .filter((row) => (row.source ?? "").toLowerCase() === "kana")
      .map((row) => ({
        hermesSessionKey: row.id,
        title: row.title || "Untitled",
        preview: rewriteMediaTags(row.preview || ""),
        messageCount: row.message_count ?? 0,
        startedAt: row.started_at ?? 0,
        // Hermes 0.22 dropped last_active from this row but still orders the
        // list most recent first. Zero keeps that order stable in the client.
        lastActive: row.last_active ?? 0,
      }));
    // Hermes 0.22 dropped last_active from session.list but returns rows most
    // recent first; a zero keeps that order through the client's stable sort
    // instead of re-sorting by start time.
    return Response.json({ sessions }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 502);
  }
});
