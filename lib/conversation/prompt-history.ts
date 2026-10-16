import type { KanaMessage } from "@/lib/conversation/types";

/**
 * The prompts this conversation has sent, newest first.
 *
 * Restored history and live turns land in the same message list, so the arrows
 * walk exactly the user rows the transcript shows, in the order they were sent.
 * Command notes and replies are not prompts and stay out.
 */
export function promptHistory(messages: KanaMessage[]): string[] {
  const prompts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.text?.trim();
    if (text) prompts.push(text);
  }
  return prompts;
}

/** Where the composer sits while its arrows walk `promptHistory`. */
export type PromptRecall = {
  /** Index into the history; -1 is the draft the reader is writing. */
  index: number;
  /** The unsent draft the walk started from, put back at the end of it. */
  draft: string;
};

/** The composer is not walking history. */
export const NO_PROMPT_RECALL: PromptRecall = { index: -1, draft: "" };

export type PromptRecallStep = {
  recall: PromptRecall;
  /** What the composer shows after the arrow. */
  text: string;
};

/**
 * One arrow press over the sent prompts: "older" is ArrowUp, "newer" is
 * ArrowDown. A null step means the walk cannot move — an empty history, the
 * oldest prompt, or the live draft at the near end — and the textarea keeps the
 * key so it moves the caret instead.
 *
 * Typing is not part of the walk: the composer ends it as soon as the text
 * changes, so the draft the reader typed is never replaced by the older one a
 * hidden walk still held.
 */
export function stepPromptRecall(
  history: string[],
  recall: PromptRecall,
  direction: "older" | "newer",
  draft: string,
): PromptRecallStep | null {
  // The walk survives the list changing under it: `/undo` drops the newest
  // prompt, so the index is clamped to what is still there.
  const index = Math.min(Math.max(recall.index, -1), history.length - 1);
  if (direction === "older") {
    // -1 is the live draft, so the first ArrowUp loads history[0].
    if (index >= history.length - 1) return null;
    const next = index + 1;
    return {
      recall: { index: next, draft: index === -1 ? draft : recall.draft },
      text: history[next],
    };
  }
  if (index === -1) return null;
  const next = index - 1;
  return {
    recall: { index: next, draft: next === -1 ? "" : recall.draft },
    text: next === -1 ? recall.draft : history[next],
  };
}

/**
 * Whether the caret may recall, which is only where the key has no line left to
 * move to: the first line for ArrowUp and the last for ArrowDown, with nothing
 * selected. A draft with real line breaks keeps both arrows for the caret.
 */
export function caretAtPromptEdge(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "older" | "newer",
): boolean {
  if (selectionStart !== selectionEnd) return false;
  return direction === "older"
    ? !value.slice(0, selectionStart).includes("\n")
    : !value.slice(selectionEnd).includes("\n");
}