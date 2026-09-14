import { classifyHermesTool } from "@/lib/agent/tool-kind";
import type { ActivityItem, AgentHistoryRow } from "@/lib/agent/types";
import { createId, type KanaMessage } from "@/lib/conversation/types";
import { parseKanaResponse } from "@/lib/presentation/response-parser";

// Pure projections between Hermes display rows and Kana's message model.
// Kept free of React so restore/merge behavior is unit-testable.

/** BCP 47 "undetermined": a plain reply that bypassed the response envelope. */
const UNKNOWN_SUBTITLE_LANGUAGE = "und";

export function createUserMessage(text: string): KanaMessage {
  return {
    id: createId("message"),
    role: "user",
    text,
    timestamp: Date.now(),
  };
}

export function createSystemMessage(text: string, command?: string): KanaMessage {
  return {
    id: createId("message"),
    role: "system",
    text,
    command,
    timestamp: Date.now(),
  };
}

export function withoutLastUserTurn(messages: KanaMessage[]): KanaMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages.slice(0, index);
  }
  return messages;
}

export type RestoredTurn = {
  turnIndex: number;
  anchorMs: number;
  activities: ActivityItem[];
};

/**
 * Rebuild Kana's display model from Hermes display rows (session.resume
 * messages, or session.history as fallback). The projection carries NO
 * timestamps, so rows get synthetic strictly-increasing timestamps that
 * preserve transcript order, and every turn is numbered by its
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
      let text = row.text ?? "";
      // Unwrap the kana_request wrapper: extract the raw user message
      // from the metadata envelope (string value, JSON-escaped).
      const match = /"user_message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
      if (match) {
        try {
          text = JSON.parse(`"${match[1]}"`) as string;
        } catch {
          /* keep raw text */
        }
      }
      messages.push({ ...createUserMessage(text), timestamp });
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
      const envelope = parseKanaResponse(row.text);
      speech_ja = envelope.speech_ja;
      subtitle = { ...envelope.subtitle };
      emotion = envelope.emotion ?? "neutral";
    } catch {
      // A malformed protocol object was already surfaced as an agent error
      // during the live turn. Never resurrect its raw JSON as a chat bubble
      // when Hermes history is restored.
      if (/\b(?:speech_ja|subtitle)\b/.test(row.text)) return;
      speech_ja = row.text;
      subtitle = { text: row.text, language: UNKNOWN_SUBTITLE_LANGUAGE };
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
