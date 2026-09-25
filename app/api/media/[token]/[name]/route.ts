import { withSession } from "@/lib/server/api-response";
import { deliverablePath, pathFromMediaToken } from "@/lib/server/media-links";
import { mediaResponse, notAvailable } from "@/lib/server/media-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/media/<token>/<name>: a file Hermes delivered with MEDIA:<path>.
// The token is the only input that picks the file, and only Kana's server
// can mint one (lib/server/media-links.ts). The file is checked again on
// every request, so a file deleted, replaced by a symlink, or moved into a
// denied location since the link was made is not served. <name> is only
// the file's display name.

type Context = { params: Promise<{ token: string; name: string }> };

function handler(method: "GET" | "HEAD") {
  return withSession(async (request: Request, context: Context): Promise<Response> => {
    const { token } = await context.params;
    const minted = pathFromMediaToken(token);
    const file = minted ? deliverablePath(minted) : null;
    return file ? mediaResponse(request, file, method) : notAvailable();
  });
}

export const GET = handler("GET");
export const HEAD = handler("HEAD");
