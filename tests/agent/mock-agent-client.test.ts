import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockAgentClient } from "../../lib/agent/mock-agent-client";

describe("MockAgentClient command completion", () => {
  it("suggests command fragments but does not echo an accepted command", async () => {
    const client = new MockAgentClient();
    const fragments = await client.completeCommands("/stat");
    assert.ok(fragments.some((item) => item.text === "/status"));
    assert.deepEqual(await client.completeCommands("/status "), []);
  });
});
