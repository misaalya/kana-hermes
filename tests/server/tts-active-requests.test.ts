import assert from "node:assert/strict";
import { it } from "node:test";
import { trackTtsRequest, cancelTtsRequest } from "@/lib/server/tts-provider/active-requests";
import type { ServerTtsProvider } from "@/lib/server/tts-provider/types";

it("cancellation uses the original provider and rejects duplicate active IDs", async () => {
  let cancels = 0;
  const provider = { cancel: async (id: string) => { assert.equal(id, "original"); cancels++; return true; } } as unknown as ServerTtsProvider;
  const active = trackTtsRequest("original", provider);
  assert.throws(() => trackTtsRequest("original", {} as ServerTtsProvider), /already running/);
  assert.equal(await cancelTtsRequest("original", new AbortController().signal), true);
  assert.equal(active.signal.aborted, true);
  assert.equal(cancels, 1);
  active.finish();
  assert.equal(await cancelTtsRequest("original", new AbortController().signal), false);
});

it("cancels a provider without an upstream cancel hook by aborting its request", async () => {
  const active = trackTtsRequest("local-engine", {} as ServerTtsProvider);
  assert.equal(await cancelTtsRequest("local-engine", new AbortController().signal), true);
  assert.equal(active.signal.aborted, true);
  active.finish();
});
