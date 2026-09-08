import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryConversationStore } from "@/lib/conversation/memory-conversation-store";

it("isolates each workspace's conversation working set", async () => {
  const first = new MemoryConversationStore();
  const second = new MemoryConversationStore();
  const conversation = await first.create({ subtitleLanguage: "en" });
  assert.equal((await first.list()).length, 1);
  assert.deepEqual(await second.list(), []);
  assert.equal(await second.get(conversation.id), null);
  assert.equal(await second.rename(conversation.id, "Other workspace"), null);
  await second.delete(conversation.id);
  assert.equal((await first.get(conversation.id))?.title, conversation.title);
  await first.rename(conversation.id, "Updated");
  assert.equal((await first.get(conversation.id))?.title, "Updated");
  await first.delete(conversation.id);
  assert.deepEqual(await first.list(), []);
});
