import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  commandArgumentHint,
  commandArgumentPolicy,
  commandRequiresArgument,
} from "@/lib/agent/command-arguments";

describe("Hermes command argument hints", () => {
  it("reads the usage hint from a catalog description", () => {
    assert.equal(
      commandArgumentHint(
        "/steer",
        "Inject a message after the next tool call without interrupting (usage: /steer <prompt>)",
      ),
      "<prompt>",
    );
    assert.equal(
      commandArgumentHint(
        "/save",
        "Export the current conversation (bare /save shows usage) (usage: /save <json|md|html> [filename] [redact])",
      ),
      "<json|md|html> [filename] [redact]",
    );
  });

  it("reads a hint even when Hermes localizes the wrapper around it", () => {
    assert.equal(
      commandArgumentHint("/steer", "Mengirim pesan (penggunaan: /steer <prompt>)"),
      "<prompt>",
    );
  });

  it("does not invent a hint for an alias or an unrelated parenthetical", () => {
    assert.equal(commandArgumentHint("/s", "Inject a message (alias for /steer)"), null);
    assert.equal(commandArgumentHint("/steer", "Inject a message (see /steer docs)"), null);
    assert.equal(commandArgumentHint("/steer", undefined), null);
  });

  it("treats angled placeholders outside optional groups as required", () => {
    assert.equal(commandRequiresArgument("<prompt>"), true);
    assert.equal(commandRequiresArgument("<json|md|html> [filename] [redact]"), true);
    assert.equal(commandRequiresArgument("[interval] <prompt> [--times N]"), true);
    assert.equal(commandRequiresArgument("[level|show|hide|full|clamp] [--global]"), false);
    assert.equal(commandRequiresArgument("[<prompt>|list|clear]"), false);
    assert.equal(commandRequiresArgument(""), false);
  });

  it("requires a level for /reasoning even though Hermes' hint is optional", () => {
    assert.deepEqual(commandArgumentPolicy("/reasoning", "[level] [--global]"), {
      hint: "[level] [--global]",
      required: true,
    });
    assert.deepEqual(commandArgumentPolicy("/reasoning", null), {
      hint: "[level|show|hide|full|clamp] [--global]",
      required: true,
    });
    assert.deepEqual(commandArgumentPolicy("/title", "[name]"), {
      hint: "[name]",
      required: false,
    });
  });
});
