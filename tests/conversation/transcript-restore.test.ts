import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planHydration } from "@/lib/conversation/session-recency";
import {
  extractKanaUserMessage,
  mergeRestoredMessages,
  parseHermesTranscript,
} from "@/lib/conversation/transcript-restore";
import {
  buildKanaResumeSeedPrefix,
  buildKanaUserPrompt,
} from "@/lib/presentation/persona";

const TYPED = "Hai Kana Chan apa kabar jawab dengan dengan singkat";

type DirectoryEntry = {
  hermesSessionKey: string;
  title: string;
  messageCount: number;
  startedAt: number;
};

function entry(
  key: string,
  messageCount: number,
  startedAt: number,
): DirectoryEntry {
  return { hermesSessionKey: key, title: key, messageCount, startedAt };
}

describe("extractKanaUserMessage", () => {
  it("returns only the typed message for a plain wrapped prompt", () => {
    const stored = buildKanaUserPrompt(TYPED, "id");
    assert.equal(extractKanaUserMessage(stored), TYPED);
  });

  it("unwraps a prompt carrying the current resume-seed prefix", () => {
    const stored = [
      buildKanaResumeSeedPrefix("en"),
      "",
      buildKanaUserPrompt(TYPED, "id"),
    ].join("\n\n");
    assert.equal(extractKanaUserMessage(stored), TYPED);
  });

  it("unwraps legacy rows whose seed started with [System:", () => {
    const legacySeed = [
      "[System: Session re-attached from the Kana web UI. Re-stating the standing",
      "presentation contract for this session. It applies from here on:]",
      "",
      'Response format (mandatory): {"speech_ja": ...}',
      "]",
    ].join("\n");
    const stored = [legacySeed, "", buildKanaUserPrompt(TYPED, "id")].join(
      "\n\n",
    );
    assert.equal(extractKanaUserMessage(stored), TYPED);
  });

  it("preserves braces inside the user's own message", () => {
    const withJson = 'contoh objek: {"a": 1}';
    const stored = buildKanaUserPrompt(withJson, "id");
    assert.equal(extractKanaUserMessage(stored), withJson);
  });

  it("keeps non-envelope rows verbatim", () => {
    const plain = "pesan dari permukaan lain";
    assert.equal(extractKanaUserMessage(plain), plain);
  });

  it("keeps truncated envelopes verbatim instead of dropping text", () => {
    const truncated = `Use the following presentation metadata.\n\n{"kana_request":`;
    assert.equal(extractKanaUserMessage(truncated), truncated);
  });
});

describe("parseHermesTranscript", () => {
  it("projects user rows to the typed message without wrapper prose", () => {
    const { messages } = parseHermesTranscript([
      { role: "user", text: buildKanaUserPrompt(TYPED, "id") },
      {
        role: "assistant",
        text: JSON.stringify({
          speech_ja: "元気だよ",
          subtitle: { text: "Baik kok", language: "id" },
          emotion: "happy",
        }),
      },
    ]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, "user");
    assert.equal(messages[0]?.text, TYPED);
    assert.equal(messages[1]?.speech_ja, "元気だよ");
    assert.deepEqual(messages[1]?.subtitle, { text: "Baik kok", language: "id" });
  });

  it("skips system rows and folds tool rows into the reply's turn", () => {
    const { messages, turns } = parseHermesTranscript([
      { role: "system", text: "seed" },
      { role: "user", text: TYPED },
      { role: "tool", name: "terminal", context: "ls -la" },
      {
        role: "assistant",
        text: JSON.stringify({
          speech_ja: "こんにちは",
          subtitle: { text: "Halo", language: "id" },
        }),
      },
    ]);
    assert.equal(messages.length, 2);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turnIndex, 0);
    assert.equal(turns[0]?.activities[0]?.tool, "terminal");
    assert.equal(messages[1]?.activities?.length, 1);
  });

  it("falls back to raw text for plain-text assistant replies", () => {
    const { messages } = parseHermesTranscript([
      { role: "assistant", text: "plain answer" },
    ]);
    assert.equal(messages[0]?.subtitle?.text, "plain answer");
  });
});

describe("mergeRestoredMessages", () => {
  it("consumes the local optimistic copy of an unwrapped user row", () => {
    const restored = parseHermesTranscript([
      { role: "user", text: buildKanaUserPrompt(TYPED, "id") },
    ]).messages;
    const merged = mergeRestoredMessages(restored, [
      {
        id: "local-1",
        role: "user",
        text: TYPED,
        timestamp: 1,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.text, TYPED);
  });

  it("keeps local-only notices and appends them after the restored block", () => {
    const restored = parseHermesTranscript([
      { role: "user", text: buildKanaUserPrompt(TYPED, "id") },
    ]).messages;
    const localOnly = {
      id: "sys-1",
      role: "system" as const,
      text: "Command complete",
      timestamp: 2,
    };
    const merged = mergeRestoredMessages(restored, [
      {
        id: "local-1",
        role: "user",
        text: TYPED,
        timestamp: 1,
      },
      localOnly,
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[1]?.id, "sys-1");
  });

  it("deduplicates assistant replies by speech and subtitle identity", () => {
    const restored = parseHermesTranscript([
      {
        role: "assistant",
        text: JSON.stringify({
          speech_ja: "元気だよ",
          subtitle: { text: "Baik kok", language: "id" },
        }),
      },
    ]).messages;
    const merged = mergeRestoredMessages(restored, [
      {
        id: "local-a",
        role: "assistant",
        speech_ja: "元気だよ",
        subtitle: { text: "Baik kok", language: "id" },
        emotion: "neutral",
        timestamp: 1,
      },
    ]);
    assert.equal(merged.length, 1);
  });
});

describe("resume-seed wire constraint", () => {
  // hermes serve hides user rows starting with "[System:" from every display
  // projection (_is_display_hidden_marker); a seeded turn must survive.
  it("does not emit a [System: leading marker", () => {
    const prefix = buildKanaResumeSeedPrefix("en");
    assert.ok(!prefix.trimStart().startsWith("[System:"));
  });
});

describe("planHydration", () => {
  it("picks the first non-empty entry in server order, not max started_at", () => {
    const remote = [
      entry("recent-active", 5, 100),
      entry("older-but-created-later", 9, 500),
      entry("empty-newest", 0, 900),
    ];
    const { best } = planHydration(remote);
    assert.equal(best?.hermesSessionKey, "recent-active");
  });

  it("returns null best and everything as rest when nothing has content", () => {
    const remote = [entry("a", 0, 1), entry("b", 0, 2)];
    const { best, restOldestFirst } = planHydration(remote);
    assert.equal(best, null);
    assert.deepEqual(
      restOldestFirst.map((item) => item.hermesSessionKey),
      ["b", "a"],
    );
  });

  it("orders the rest oldest-first for sequential insertion stamps", () => {
    const remote = [
      entry("newest", 3, 30),
      entry("middle", 2, 20),
      entry("oldest", 1, 10),
    ];
    const { best, restOldestFirst } = planHydration(remote);
    assert.equal(best?.hermesSessionKey, "newest");
    assert.deepEqual(
      restOldestFirst.map((item) => item.hermesSessionKey),
      ["oldest", "middle"],
    );
  });
});
