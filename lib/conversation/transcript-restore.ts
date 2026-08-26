import { classifyHermesTool } from "@/lib/agent/tool-kind";
import type { ActivityItem, AgentHistoryRow } from "@/lib/agent/types";
import { createId, type KanaMessage } from "./types";

/**
 * Pure transcript-restore projection: Hermes display rows (session.resume
 * messages, or session.history as fallback) -> Kana's display model.
 *
 * Kept free of React so the kana_request unwrap and merge rules are unit
 * testable against real recorded Hermes row shapes.
 */

export type RestoredTurn = {
  turnIndex: number;
  anchorMs: number;
  activities: ActivityItem[];
};

/**
 * Extract the text the user actually typed from a stored Hermes user row.
 *
 * Kana submits every prompt wrapped (see persona.buildKanaUserPrompt):
 *
 *   <optional resume-seed prefix>
 *   "Use the following presentation metadata …"
 *   { "kana_request": …, "user_message": "<typed text>" }
 *
 * The envelope is always the LAST JSON object in the stored text, but the
 * resume-seed prefix itself contains JSON *examples* (the response contract),
 * so scanning forward from the first "{" grabs an example brace and fails —
 * which is exactly how the raw prompt used to leak into restored bubbles.
 * Scan backwards instead: the first index whose tail parses AND carries a
 * string user_message is the real envelope.
 *
 * Display shows ONLY the typed message. Every other byte of the row is
 * Kana-generated plumbing (wrapper header, seed contract) and must never
 * reach the UI; keeping it also broke merge identity against the local
 * optimistic copy, which is what produced duplicate bubbles after a
 * refresh/reopen. Rows that are not kana envelopes (typed on another
 * surface) come back verbatim.
 */
export function extractKanaUserMessage(text: string): string {
  let braceIndex = text.lastIndexOf("{");
  while (braceIndex !== -1) {
    try {
      const envelope = JSON.parse(text.slice(braceIndex)) as {
        user_message?: unknown;
      };
      if (typeof envelope.user_message === "string" && envelope.user_message) {
        return envelope.user_message;
      }
    } catch {
      /* inner/nested or example brace — keep scanning backwards */
    }
    braceIndex = text.lastIndexOf("{", braceIndex - 1);
  }
  return text;
}

/**
 * Rebuild Kana's display model from Hermes display rows. The projection
 * carries NO timestamps, so rows get synthetic strictly-increasing timestamps
 * that preserve transcript order, and every turn is numbered by its
 * assistant-reply ordinal — the cross-browser identity used by the
 * server-side activity store.
 */
export function parseHermesTranscript(rows: AgentHistoryRow[]): {
  messages: KanaMessage[];
  turns: RestoredTurn[];
} {
  const messages: KanaMessage[] = [];
  const turns: RestoredTurn[] = [];
  let pendingActivities: ActivityItem[] = [];
  let assistantOrdinal = 0;
  const baseTimestamp = Date.now() - rows.length - 1;

  rows.forEach((row, rowIndex) => {
    const timestamp = baseTimestamp + rowIndex;
    if (row.role === "system") return;
    if (row.role === "tool") {
      const tool = row.name ?? "tool";
      pendingActivities.push({
        id: createId("activity"),
        tool,
        kind: classifyHermesTool(tool),
        title: row.context || `${tool} finished`,
        state: "complete",
        timestamp,
      });
      return;
    }
    if (row.role === "user") {
      messages.push({
        ...createUserMessage(extractKanaUserMessage(row.text ?? "")),
        timestamp,
      });
      return;
    }
    if (row.role !== "assistant" || !row.text?.trim()) return;
    const turnIndex = assistantOrdinal;
    assistantOrdinal += 1;
    let turn: RestoredTurn | undefined;
    if (pendingActivities.length) {
      // Anchor just after the LAST tool so the block sorts between the
      // tools and Kana's reply.
      turn = {
        turnIndex,
        anchorMs:
          Math.max(...pendingActivities.map((activity) => activity.timestamp)) +
          1,
        activities: pendingActivities,
      };
      turns.push(turn);
      pendingActivities = [];
    }
    let speech_ja = "";
    let subtitle: KanaMessage["subtitle"] = undefined;
    let emotion: KanaMessage["emotion"] = "neutral";
    try {
      const envelope = JSON.parse(row.text) as {
        speech_ja?: string;
        subtitle?: { text?: string; language?: string };
        emotion?: KanaMessage["emotion"];
      };
      speech_ja = envelope.speech_ja ?? "";
      if (envelope.subtitle?.text) {
        subtitle = {
          text: envelope.subtitle.text,
          language: envelope.subtitle.language ?? "id",
        };
      }
      emotion = envelope.emotion ?? "neutral";
    } catch {
      speech_ja = row.text;
      subtitle = { text: row.text, language: "id" };
    }
    messages.push({
      id: createId("message"),
      role: "assistant",
      speech_ja,
      subtitle,
      emotion,
      timestamp,
      activities: turn ? [...turn.activities] : undefined,
    });
  });

  return { messages, turns };
}

function createUserMessage(text: string): KanaMessage {
  return {
    id: createId("message"),
    role: "user",
    text,
    timestamp: Date.now(),
  };
}

function restoredMessageMatches(
  local: KanaMessage,
  restored: KanaMessage,
): boolean {
  if (local.role !== restored.role) return false;
  if (restored.role === "user") return local.text === restored.text;
  if (restored.role === "assistant") {
    return (
      local.speech_ja === restored.speech_ja &&
      local.subtitle?.text === restored.subtitle?.text
    );
  }
  return false;
}

/**
 * Hermes rows are authoritative, but local-only rows must survive the
 * replace: the just-typed message that triggered the session open, queued
 * prompts, and system notices never exist in Hermes display rows. Each
 * restored row consumes at most one matching local copy; leftovers are
 * appended after the restored block.
 */
export function mergeRestoredMessages(
  restored: KanaMessage[],
  local: KanaMessage[],
): KanaMessage[] {
  const kept = [...local];
  for (const message of restored) {
    const index = kept.findIndex((candidate) =>
      restoredMessageMatches(candidate, message),
    );
    if (index !== -1) kept.splice(index, 1);
  }
  return [...restored, ...kept];
}
