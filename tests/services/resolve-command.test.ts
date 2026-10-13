import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AgentCommandSuggestion } from "@/lib/agent/types";
import { resolveTypedCommand, shortTitle } from "@/lib/services/send-message";

function suggestion(text: string, availability?: "available" | "unavailable"): AgentCommandSuggestion {
  return { text, display: text, kind: "command", ...(availability ? { availability } : {}) };
}

/**
 * What Hermes's own completer answers for `/codex-run`, as the adapter stores
 * it (the composer's suggestion text always carries the leading slash).
 * `/codex-run` is a prefix of `/codex-runtime`, so the nearest-match logic
 * there is what Enter reuses here.
 */
const CODEX = [suggestion("/codex-runtime")];

describe("resolveTypedCommand", () => {
  it("sends the nearest command for a name Hermes does not know", () => {
    assert.equal(resolveTypedCommand("/codex-run", CODEX), "/codex-runtime");
  });

  it("keeps a name that is already a known command", () => {
    const suggestions = [suggestion("/model"), suggestion("/model-options")];
    assert.equal(resolveTypedCommand("/model", suggestions), "/model");
  });

  it("leaves a message that is not a command alone", () => {
    assert.equal(resolveTypedCommand("hello /codex-run", CODEX), "hello /codex-run");
  });

  it("sends the typed command when nothing matched", () => {
    assert.equal(resolveTypedCommand("/perintah-ngawur", []), "/perintah-ngawur");
  });

  it("never attaches the completion's argument fallback", () => {
    // /conf offers `/config ` only because this Hermes version could not
    // complete the name later. Pasting the argument over it would run /config
    // with a stray argument, so only the name is used.
    assert.equal(resolveTypedCommand("/conf", [suggestion("/config ")]), "/config");
  });

  it("does not rewrite a typed command that carries arguments", () => {
    // `startsWith` is not `startsWith "/"`: /path shares a spelling with the
    // skill /path-fix but is a different command, and Hermes reports no
    // completion while an argument is being typed.
    assert.equal(resolveTypedCommand("/path /tmp", []), "/path /tmp");
  });

  it("keeps the typed arguments when the name is replaced", () => {
    // Hermes reports no completion once an argument is typed, but a stale menu
    // can still hold one; the arguments belong to what the user typed.
    assert.equal(resolveTypedCommand("/codex-run auto", CODEX), "/codex-runtime auto");
  });

  it("does not turn a multi-word command into an argument", () => {
    // /mcp add names a command whose remainder is another word, not an
    // argument. Nothing matched the typed name, so it goes as typed.
    assert.equal(resolveTypedCommand("/mcp add", CODEX), "/mcp add");
  });

  it("normalizes underscores on the typed name before matching", () => {
    assert.equal(resolveTypedCommand("/codex_run", CODEX), "/codex-runtime");
  });

  it("prefers the typed name over a longer completion sharing its prefix", () => {
    // The observed /conf case: `/config ` is returned for a name Hermes
    // cannot complete. It matches only by prefix, and the command it names is
    // not itself a known command, so the completion's name is used.
    assert.equal(resolveTypedCommand("/con", [suggestion("/config "), suggestion("/connect")]), "/config");
  });

  it("keeps non-command text unchanged", () => {
    assert.equal(resolveTypedCommand("", CODEX), "");
    assert.equal(resolveTypedCommand("   ", CODEX), "");
    assert.equal(shortTitle("hello world"), "hello world");
  });
});