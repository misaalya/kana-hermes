import { isInterruptionNotice } from "@/lib/agent/interruption-notice";
import { classifyHermesTool } from "@/lib/agent/tool-kind";
import type { ActivityItem, AgentHistoryRow } from "@/lib/agent/types";
import { createId, type KanaMessage } from "@/lib/conversation/types";
import { unwrapKanaUserPrompt } from "@/lib/presentation/persona";
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
  /** Assistant-reply ordinal, or null for a turn that ended without a reply. */
  turnIndex: number | null;
  anchorMs: number;
  activities: ActivityItem[];
};

type AssistantRow = { text: string; timestamp: number };

type TranscriptGroup = {
  user?: KanaMessage;
  corrections: KanaMessage[];
  activities: ActivityItem[];
  assistants: AssistantRow[];
  /** The last assistant row is tool-call narration, not this turn's reply. */
  lastAssistantFollowedByTool: boolean;
};

function emptyGroup(): TranscriptGroup {
  return { corrections: [], activities: [], assistants: [], lastAssistantFollowedByTool: false };
}

/** Parse one assistant row into the fields a Kana message needs. */
function parseAssistantRow(
  text: string,
): Pick<KanaMessage, "speech_ja" | "subtitle" | "emotion"> | null {
  try {
    const envelope = parseKanaResponse(text);
    return {
      speech_ja: envelope.speech_ja,
      subtitle: { ...envelope.subtitle },
      emotion: envelope.emotion ?? "neutral",
    };
  } catch {
    // A malformed protocol object was already surfaced as an agent error
    // during the live turn. Never resurrect its raw JSON as a chat bubble
    // when Hermes history is restored.
    if (/\b(?:speech_ja|subtitle)\b/.test(text)) return null;
    return {
      speech_ja: "",
      subtitle: { text, language: UNKNOWN_SUBTITLE_LANGUAGE },
      emotion: "neutral",
    };
  }
}

/**
 * Rebuild Kana's display model from Hermes display rows (session.resume
 * messages, or session.history as fallback).
 *
 * Only the LAST assistant row of a user turn is its reply. Earlier assistant
 * rows are the tool-call narration Hermes also streams as `message.interim`,
 * which Kana leaves out of the live feed; hiding them here keeps a refresh
 * from showing a different conversation. Hermes's retry/cancellation control
 * notices are not replies either.
 *
 * Rows use Hermes's display timestamp when present, falling back to strictly
 * increasing synthetic times. Every reply is numbered by its substantive
 * assistant ordinal — the cross-browser identity shared with live commits and
 * the server-side activity store.
 *
 * Hermes stores each tool as it finishes, so tools in a still-running final
 * turn come back as `unfinished`.
 */
export function parseHermesTranscript(rows: AgentHistoryRow[]): {
  messages: KanaMessage[];
  turns: RestoredTurn[];
  unfinished: ActivityItem[];
} {
  const messages: KanaMessage[] = [];
  const turns: RestoredTurn[] = [];
  let unfinished: ActivityItem[] = [];
  let assistantOrdinal = 0;
  let previousRole: string | undefined;
  const baseTimestamp = Date.now() - rows.length - 1;
  let lastTimestamp = 0;
  const timestampOf = (row: AgentHistoryRow, rowIndex: number): number => {
    const display = typeof row.timestamp === "number" && row.timestamp > 0
      ? row.timestamp * 1000
      : baseTimestamp + rowIndex;
    // Keep at least 1 ms between rows so mergeRestoredMessages can slot a
    // local-only message between any two restored rows.
    lastTimestamp = Math.max(lastTimestamp + 1, display);
    return lastTimestamp;
  };
  let group = emptyGroup();

  const saveTurn = (index: number | null, replyAt?: number): RestoredTurn | undefined => {
    if (!group.activities.length) return undefined;
    // Anchor just after the LAST tool so the block sorts between the tools and
    // the reply; the same rule as a live commit. A reply-less turn has no reply
    // time to cap against.
    const lastTool = Math.max(
      ...group.activities.map((activity) => activity.timestamp),
    ) + 1;
    const turn: RestoredTurn = {
      turnIndex: index,
      anchorMs: replyAt === undefined ? lastTool : Math.min(lastTool, replyAt),
      activities: group.activities,
    };
    turns.push(turn);
    return turn;
  };

  const flush = (last: boolean) => {
    if (group.user) {
      messages.push(group.user, ...group.corrections);
      const reply = group.lastAssistantFollowedByTool ? undefined : group.assistants.at(-1);
      const parsed = reply && !isInterruptionNotice(reply.text)
        ? parseAssistantRow(reply.text)
        : null;
      if (reply && parsed) {
        const index = assistantOrdinal;
        const turn = saveTurn(index, reply.timestamp);
        messages.push({
          id: createId("message"),
          role: "assistant",
          ...parsed,
          timestamp: reply.timestamp,
          ...(turn ? { activities: [...turn.activities] } : {}),
        });
        assistantOrdinal += 1;
      } else {
        // The turn ended without a visible reply (stop, retry notice, broken
        // envelope, or tools still pending). Its tools are still an activity
        // block of their own.
        saveTurn(null);
        if (last) unfinished = group.activities;
      }
    } else {
      // Rows before the first user turn (or a transcript with no user at all)
      // have no turn to group: each assistant row is its own message.
      let lastMessage: KanaMessage | undefined;
      for (const assistantRow of group.assistants) {
        if (isInterruptionNotice(assistantRow.text)) continue;
        const parsed = parseAssistantRow(assistantRow.text);
        if (!parsed) continue;
        const message: KanaMessage = {
          id: createId("message"),
          role: "assistant",
          ...parsed,
          timestamp: assistantRow.timestamp,
        };
        messages.push(message);
        lastMessage = message;
        assistantOrdinal += 1;
      }
      if (lastMessage) {
        const turn = saveTurn(assistantOrdinal - 1, lastMessage.timestamp);
        if (turn) lastMessage.activities = [...turn.activities];
      } else {
        saveTurn(null);
        if (last) unfinished = group.activities;
      }
    }
    group = emptyGroup();
  };

  rows.forEach((row, rowIndex) => {
    if (row.role === "system") return;
    if (row.role === "tool") {
      const tool = row.name ?? "tool";
      group.activities.push({
        id: createId("activity"),
        tool,
        kind: classifyHermesTool(tool),
        title: row.context || `${tool} finished`,
        state: "complete",
        timestamp: timestampOf(row, rowIndex),
      });
      if (group.assistants.length) group.lastAssistantFollowedByTool = true;
      previousRole = "tool";
      return;
    }
    if (row.role === "user") {
      const timestamp = timestampOf(row, rowIndex);
      // A user row that lands while the turn still has unfinished tools, or
      // straight after another user row, is Hermes's active-turn redirect: it
      // belongs under that turn's first message, not beside it as a new turn.
      // Tools that already have a following assistant are that reply's tools,
      // not pending work, so the next user row starts a normal turn.
      const correction =
        group.user !== undefined
        && (
          previousRole === "user"
          || group.lastAssistantFollowedByTool
          || (group.activities.length > 0 && group.assistants.length === 0)
        );
      // Strip the Kana note (or the older kana_request JSON wrapper) so the
      // restored bubble shows only what the user typed.
      const message: KanaMessage = {
        ...createUserMessage(unwrapKanaUserPrompt(row.text ?? "")),
        timestamp,
        ...(correction ? { correction: "redirected" as const } : {}),
      };
      if (correction) {
        group.corrections.push(message);
      } else {
        flush(false);
        group.user = message;
      }
      previousRole = "user";
      return;
    }
    if (row.role !== "assistant") return;
    previousRole = "assistant";
    if (!row.text?.trim()) return;
    group.assistants.push({ text: row.text, timestamp: timestampOf(row, rowIndex) });
    group.lastAssistantFollowedByTool = false;
  });

  flush(true);
  return { messages, turns, unfinished };
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
 * prompts, and Kana's commands with their notices never exist in Hermes
 * display rows. Each restored row consumes at most one matching local copy.
 * A leftover stays right after the restored row its local predecessor
 * matched, and is re-timed there: the chat is ordered by time, so an old
 * timestamp would lift it above the whole restored transcript.
 */
export function mergeRestoredMessages(
  restored: KanaMessage[],
  local: KanaMessage[],
): KanaMessage[] {
  // An older build committed Hermes's retry/cancellation control text as a
  // reply. Restore no longer projects it, so the local copy must not survive.
  const localRows = local.filter(
    (message) =>
      !(message.role === "assistant" && isInterruptionNotice(message.subtitle?.text ?? "")),
  );
  if (!restored.length) return localRows;
  const matched = new Map<KanaMessage, number>();
  /** Local knowledge of a correction the restored row cannot prove by itself. */
  const corrections = new Map<number, NonNullable<KanaMessage["correction"]>>();
  restored.forEach((row, index) => {
    const copy = localRows.find((message) => !matched.has(message) && restoredMessageMatches(message, row));
    if (copy) {
      matched.set(copy, index);
      if (copy.role === "user" && copy.correction) corrections.set(index, copy.correction);
    }
  });

  // Local-only rows by the restored row they follow; -1 is before the first.
  const leftovers = new Map<number, KanaMessage[]>();
  let after = -1;
  for (const message of localRows) {
    const index = matched.get(message);
    if (index !== undefined) after = Math.max(after, index);
    else leftovers.set(after, [...(leftovers.get(after) ?? []), message]);
  }

  const merged: KanaMessage[] = [];
  const place = (slot: number) => {
    const rows = leftovers.get(slot) ?? [];
    // Restored rows are at least 1 ms apart, so fractions fit between them.
    const from = slot >= 0 ? restored[slot].timestamp : restored[0].timestamp - 1;
    rows.forEach((message, index) =>
      merged.push({ ...message, timestamp: from + (index + 1) / (rows.length + 1) }),
    );
  };
  place(-1);
  restored.forEach((row, index) => {
    const correction = corrections.get(index);
    merged.push(correction && row.role === "user" ? { ...row, correction } : row);
    place(index);
  });
  return merged;
}
