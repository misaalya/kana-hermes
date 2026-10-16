import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { closeLiveStreams } from "@/lib/server/live-streams";
import { readJsonObject } from "@/lib/server/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stops THIS Kana server so the user can run the npm install command. The
// signal is sent after the response is written, and it is SIGTERM to this
// process (not SIGKILL, not process.exit), so a launcher/custom server
// shutdown still runs.
//
// Only Kana stops. A `hermes serve` Kana started is spawned non-detached and
// nothing here signals it, so it is left running; `hermes serve` the user
// started is not ours to stop at all. The local voice engine is a short-lived
// per-utterance child, not a supervised service.
//
// Next's production shutdown is `server.close(callback)`, which waits for
// every open connection. The tab that renders this notice also holds
// GET /api/hermes/events (SSE) open, and that stream only ends when the
// Hermes gateway drops, so `closeLiveStreams()` ends it here — before the
// signal is scheduled, so this response is still written. The remaining delay
// after that is bounded by the server's keep-alive timeout.

const MAX_BODY_BYTES = 256;
const SIGNAL_DELAY_MS = 500;

export const POST = withSession(async (request) => {
  try {
    const body = await readJsonObject(request, MAX_BODY_BYTES);
    if (body.confirm !== true) {
      return Response.json({ error: "Stopping Kana needs confirmation." }, { status: 400, headers: NO_STORE });
    }
    closeLiveStreams();
    setTimeout(() => process.kill(process.pid, "SIGTERM"), SIGNAL_DELAY_MS);
    return Response.json({ stopping: true }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error);
  }
});