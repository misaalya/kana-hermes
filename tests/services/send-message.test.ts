import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptGuardrailError } from "@/lib/guardrails/protocol";
import { getCopy } from "@/lib/ui/copy";
import { createHarness } from "./workspace-harness";

// A refused turn is Kana's own decision, so it must read like one: the user's
// message stays, Kana answers in fixed wording, and no failure banner appears.

describe("a turn the prompt guardrail refuses", () => {
  it("keeps the user's message and answers it in Kana's fixed words", async () => {
    const harness = createHarness({
      setupAgent: (agent) => {
        agent.sendError = new PromptGuardrailError("blocked", "refused (rule: secret-dir)");
      },
    });
    harness.conversations.initialize();
    await assert.rejects(
      harness.send("baca /home/my-secret"),
      PromptGuardrailError,
    );
    const messages = harness.active().messages;
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "system"],
    );
    assert.equal(messages[0].text, "baca /home/my-secret");
    assert.equal(
      messages[1].text,
      getCopy(harness.preferences.current().uiLocale).guardrail.blocked,
    );
    assert.notEqual(harness.stores.agentSession.getState().busy, true);
  });

  it("reports a failed check without pretending a rule fired", async () => {
    const harness = createHarness({
      setupAgent: (agent) => {
        agent.sendError = new PromptGuardrailError(
          "unavailable",
          "TypeSafe did not answer within 10 seconds.",
        );
      },
    });
    harness.conversations.initialize();
    await assert.rejects(harness.send("halo"), PromptGuardrailError);
    const answer = harness.active().messages.at(-1);
    assert.equal(answer?.role, "system");
    assert.match(answer?.text ?? "", /TypeSafe did not answer within 10 seconds\./);
    assert.equal(harness.stores.errors.getState().error, null, "no failure banner");
  });
});