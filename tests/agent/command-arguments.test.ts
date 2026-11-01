import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  commandArgumentHint,
  commandArgumentPolicy,
  commandRequiresArgument,
  hasOfferedArgument,
  lineUpCommandDraft,
  resolveTypedArguments,
  suggestionArgumentMatches,
} from "@/lib/agent/command-arguments";
import type { AgentCommandSuggestion } from "@/lib/agent/types";

function option(text: string): AgentCommandSuggestion {
  return { text, display: text, kind: "command" };
}

describe("lineUpCommandDraft", () => {
  it("moves a slash command after blank lines to the first line", () => {
    assert.equal(lineUpCommandDraft("\n\n/reas"), "/reas");
    assert.equal(lineUpCommandDraft(" \n \n  /reas hi"), "/reas hi");
    assert.equal(lineUpCommandDraft("\n/reasoning high --global"), "/reasoning high --global");
  });

  it("keeps content above the slash and a same-line space untouched", () => {
    assert.equal(lineUpCommandDraft("hello\n/reas"), "hello\n/reas");
    assert.equal(lineUpCommandDraft(" /reas"), " /reas");
    assert.equal(lineUpCommandDraft("/reas"), "/reas");
    assert.equal(lineUpCommandDraft("\n\nhello"), "\n\nhello");
    assert.equal(lineUpCommandDraft("\n\n"), "\n\n");
  });
});

describe("nearest command argument", () => {
  const reasoning = [
    option("/reasoning none"),
    option("/reasoning minimal"),
    option("/reasoning low"),
    option("/reasoning medium"),
    option("/reasoning high"),
    option("/reasoning xhigh"),
    option("/reasoning max"),
    option("/reasoning ultra"),
    option("/reasoning show"),
    option("/reasoning hide"),
    option("/reasoning full"),
    option("/reasoning clamp"),
    option("/reasoning --global"),
  ];

  it("resolves a partial first argument to the first offered option", () => {
    assert.equal(resolveTypedArguments("/reasoning hi", reasoning), "/reasoning high");
    assert.equal(resolveTypedArguments("/reasoning h", reasoning), "/reasoning high");
    assert.equal(resolveTypedArguments("/reasoning hig", reasoning), "/reasoning high");
    // Hermes lists minimal before max; the menu order is the ranking.
    assert.equal(resolveTypedArguments("/reasoning m", reasoning), "/reasoning minimal");
  });

  it("keeps later arguments and an exact option untouched", () => {
    assert.equal(
      resolveTypedArguments("/reasoning hi --global", reasoning),
      "/reasoning high --global",
    );
    assert.equal(resolveTypedArguments("/reasoning high", reasoning), "/reasoning high");
    assert.equal(resolveTypedArguments("/reasoning --glo", reasoning), "/reasoning --global");
  });

  it("only substitutes a token that the offered options match", () => {
    assert.equal(resolveTypedArguments("/reasoning hihg", reasoning), "/reasoning hihg");
    assert.equal(resolveTypedArguments("/reasoning ", reasoning), "/reasoning");
    assert.equal(
      resolveTypedArguments("/model hi", reasoning),
      "/model hi",
    );
  });

  it("leaves a free-form argument alone when no option was offered", () => {
    assert.equal(resolveTypedArguments("/steer hello", [option("/steer")]), "/steer hello");
    assert.equal(resolveTypedArguments("/steer hello", []), "/steer hello");
  });

  it("resolves only the first token of a multi-token argument", () => {
    const suggestions = [option("/mcp add foo")];
    assert.equal(resolveTypedArguments("/mcp ad foo", suggestions), "/mcp add foo");
  });

  it("matches a suggestion to the typed command and token", () => {
    assert.equal(suggestionArgumentMatches("/reasoning hi", "/reasoning high"), true);
    assert.equal(suggestionArgumentMatches("/reasoning hi", "/reasoning hide"), true);
    assert.equal(suggestionArgumentMatches("/reasoning hi", "/reasoning low"), false);
    assert.equal(suggestionArgumentMatches("/reasoning hi", "/fast normal"), false);
    assert.equal(suggestionArgumentMatches("/reasoning hi", "/reasoning"), false);
  });

  it("knows whether the menu reached the argument stage", () => {
    assert.equal(hasOfferedArgument("/reasoning hi", reasoning), true);
    assert.equal(hasOfferedArgument("/reasoning hi", [option("/reasoning")]), false);
    assert.equal(hasOfferedArgument("/reasoning", reasoning), false);
  });
});

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
