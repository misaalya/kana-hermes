import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInterruptionNotice } from "@/lib/agent/interruption-notice";

describe("Hermes interruption notices", () => {
  it("recognizes every control text Hermes writes for an interrupted turn", () => {
    for (const text of [
      "Operation interrupted: retrying API call after error (retry 1/3).",
      "Operation interrupted: handling API error (rate_limit: busy).",
      "Operation interrupted: waiting for the provider to recover (cycle 1/3).",
      "Operation interrupted: retrying empty response from model (retry 2/3).",
      "Operation interrupted: waiting for model response (idle 30s).",
      "Operation interrupted during retry (timeout, attempt 2/3).",
    ]) {
      assert.equal(isInterruptionNotice(text), true, text);
    }
  });

  it("leaves real replies alone, even when they mention an interruption", () => {
    assert.equal(isInterruptionNotice(""), false);
    assert.equal(isInterruptionNotice("The operation interrupted the download."), false);
    assert.equal(
      isInterruptionNotice("---\nemotion: neutral\nlang: en\n---\nOperation interrupted: what should I check?"),
      false,
    );
  });
});
