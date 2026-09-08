import assert from "node:assert/strict";
import { it } from "node:test";
import { trackTtsRequest, cancelTtsRequest, awaitTtsStartup } from "@/lib/server/tts-provider/active-requests";
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

it("one caller can cancel model warmup without cancelling another caller", async () => {
  let ready!: () => void;
  const startup = new Promise<void>((resolve) => { ready = resolve; });
  const caller = new AbortController();
  const cancelled = awaitTtsStartup(startup, caller.signal);
  const other = awaitTtsStartup(startup, new AbortController().signal);
  caller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  ready(); await other;
});
