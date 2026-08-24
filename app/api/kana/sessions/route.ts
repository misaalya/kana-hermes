import { hermesRpc } from "@/lib/server/hermes-bridge";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type HermesSessionRow = {
  id: string;
  title?: string;
  preview?: string;
  started_at?: number;
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
export async function GET(request: Request): Promise<Response> {
  if (!isAuthEnabled() || (await isSessionValid(request))) {
    try {
      const result = (await hermesRpc("session.list", { limit: 100 })) as {
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
        }));
      return Response.json({ sessions }, { headers: NO_STORE });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not list Hermes sessions.",
        },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
}
