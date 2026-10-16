import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_PROMPT_RECALL,
  caretAtPromptEdge,
  promptHistory,
  stepPromptRecall,
} from "@/lib/conversation/prompt-history";
import type { KanaMessage } from "@/lib/conversation/types";

let sequence = 0;
const message = (role: KanaMessage["role"], text?: string): KanaMessage => {
  sequence += 1;
  return { id: `message-${sequence}`, role, text, timestamp: sequence };
};

describe("prompt history", () => {
  it("lists the prompts this conversation sent, newest first", () => {
    assert.deepEqual(
      promptHistory([
        message("user", "first"),
        message("assistant", "reply"),
        message("system", "command note"),
        message("user", "second"),
        message("assistant", "reply"),
      ]),
      ["second", "first"],
    );
  });

  it("takes each prompt as it was shown and leaves out the empty ones", () => {
    assert.deepEqual(
      promptHistory([
        message("user", "  spaced  "),
        message("user", "   "),
        message("user"),
        message("user", "/model 9router/gpt"),
      ]),
      ["/model 9router/gpt", "spaced"],
    );
  });
});

describe("prompt recall", () => {
  it("saves the draft on the first ArrowUp and stops at the oldest prompt", () => {
    const history = ["newest", "middle", "oldest"];
    const first = stepPromptRecall(history, NO_PROMPT_RECALL, "older", "half typed");
    assert.deepEqual(first, { recall: { index: 0, draft: "half typed" }, text: "newest" });
    const second = stepPromptRecall(history, first!.recall, "older", "half typed");
    assert.deepEqual(second, { recall: { index: 1, draft: "half typed" }, text: "middle" });
    const third = stepPromptRecall(history, second!.recall, "older", "half typed");
    assert.deepEqual(third, { recall: { index: 2, draft: "half typed" }, text: "oldest" });
    assert.equal(stepPromptRecall(history, third!.recall, "older", "half typed"), null);
  });

  it("gives the draft back when ArrowDown walks past the newest prompt", () => {
    const history = ["newest", "oldest"];
    const newest = stepPromptRecall(history, NO_PROMPT_RECALL, "older", "half typed");
    const oldest = stepPromptRecall(history, newest!.recall, "older", "half typed");
    const back = stepPromptRecall(history, oldest!.recall, "newer", "half typed");
    assert.deepEqual(back, { recall: { index: 0, draft: "half typed" }, text: "newest" });
    assert.deepEqual(stepPromptRecall(history, back!.recall, "newer", "half typed"), {
      recall: NO_PROMPT_RECALL,
      text: "half typed",
    });
    assert.equal(stepPromptRecall(history, NO_PROMPT_RECALL, "newer", "half typed"), null);
  });

  it("cannot move without a prompt or a walk to return to", () => {
    assert.equal(stepPromptRecall([], NO_PROMPT_RECALL, "older", "draft"), null);
    assert.equal(stepPromptRecall([], NO_PROMPT_RECALL, "newer", "draft"), null);
    assert.equal(stepPromptRecall([], { index: 2, draft: "draft" }, "older", "draft"), null);
    assert.equal(stepPromptRecall([], { index: 2, draft: "draft" }, "newer", "draft"), null);
  });

  it("clamps a walk whose prompt was undone while it was open", () => {
    const walk = { index: 1, draft: "half typed" };
    // /undo dropped the newest prompt: only history[0] is left.
    assert.equal(stepPromptRecall(["only"], walk, "older", "half typed"), null);
    assert.deepEqual(stepPromptRecall(["only"], walk, "newer", "half typed"), {
      recall: NO_PROMPT_RECALL,
      text: "half typed",
    });
  });
});

describe("prompt recall caret", () => {
  it("recalls from the first line for ArrowUp and the last for ArrowDown", () => {
    // "first\nsecond\nthird": the second line ends at its newline on index 12.
    const value = "first\nsecond\nthird";
    assert.equal(caretAtPromptEdge(value, 0, 0, "older"), true);
    assert.equal(caretAtPromptEdge(value, 3, 3, "older"), true);
    assert.equal(caretAtPromptEdge(value, 6, 6, "older"), false);
    assert.equal(caretAtPromptEdge(value, 13, 13, "older"), false);
    assert.equal(caretAtPromptEdge(value, 13, 13, "newer"), true);
    assert.equal(caretAtPromptEdge(value, value.length, value.length, "newer"), true);
    assert.equal(caretAtPromptEdge(value, 12, 12, "newer"), false);
    assert.equal(caretAtPromptEdge(value, 3, 3, "newer"), false);
  });

  it("leaves a selection to the caret", () => {
    assert.equal(caretAtPromptEdge("hello", 0, 3, "older"), false);
    assert.equal(caretAtPromptEdge("hello", 2, 5, "newer"), false);
  });
});