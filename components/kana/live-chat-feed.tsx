"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem } from "@/lib/state/use-kana-controller";
import type { KanaMessage } from "@/lib/conversation/types";
import { ActivityStack } from "./activity-stack";

type ServerActivityTurn = {
  turnAnchorMs: number;
  turnIndex: number | null;
  activities: ActivityItem[];
};

type LiveChatFeedProps = {
  messages: KanaMessage[];
  activities: ActivityItem[];
  serverActivityTurns?: ServerActivityTurn[];
  busy: boolean;
  status: string;
};

type FeedEntry =
  | { kind: "message"; at: number; message: KanaMessage }
  | { kind: "activity"; at: number; activities: ActivityItem[] };

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export const LiveChatFeed = memo(function LiveChatFeed({
  messages,
  activities,
  serverActivityTurns = [],
  busy,
  status,
}: LiveChatFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const entries = useMemo<FeedEntry[]>(() => {
    const timeline: FeedEntry[] = messages.map((message) => ({
      kind: "message" as const,
      at: message.timestamp,
      message,
    }));
    const assistantTimestamps = messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.timestamp);

    for (const turn of serverActivityTurns) {
      if (!turn.activities.length) continue;
      const replyTimestamp = assistantTimestamps[turn.turnIndex ?? -1];
      timeline.push({
        kind: "activity",
        at: typeof replyTimestamp === "number" ? replyTimestamp - 0.5 : turn.turnAnchorMs,
        activities: turn.activities,
      });
    }

    if (activities.length) {
      const lastUser = [...timeline]
        .reverse()
        .find((entry) => entry.kind === "message" && entry.message.role === "user");
      timeline.push({
        kind: "activity",
        at: (lastUser?.at ?? Date.now()) + 0.5,
        activities,
      });
    }
    return timeline.sort((a, b) => a.at - b.at);
  }, [messages, activities, serverActivityTurns]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (pinnedToBottom) scrollToBottom();
  }, [entries.length, busy, pinnedToBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setPinnedToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 32);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 max-sm:pt-[38dvh]"
        role="log"
        aria-live="polite"
        aria-label="Live chat"
      >
        {!entries.length && !busy ? (
          <div className="m-auto flex max-w-[280px] flex-col items-center py-12 text-center max-sm:hidden">
            <h2 className="text-sm font-bold text-ink">A quiet moment with Kana</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Ask anything. Hermes will work behind the scenes while Kana stays here with you.
            </p>
          </div>
        ) : null}

        {entries.map((entry, index) => {
          if (entry.kind === "activity") {
            return <ActivityStack key={`activity-${index}`} activities={entry.activities} />;
          }
          const message = entry.message;
          const isAssistant = message.role === "assistant";
          const isSystem = message.role === "system";
          const copy = isAssistant ? message.subtitle?.text : message.text;
          if (!copy?.trim()) return null;

          if (isSystem) {
            return (
              <article key={message.id} className="border border-line bg-raised px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <strong className="text-[9px] font-bold tracking-[0.14em] text-muted uppercase">Hermes note</strong>
                  <span className="text-[9px] tabular-nums text-faint">{formatTime(message.timestamp)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-dim">{copy}</p>
              </article>
            );
          }

          return (
            <article
              key={message.id}
              className={`max-w-[88%] border px-3.5 py-3 max-sm:max-w-[92%] ${
                isAssistant
                  ? "self-start border-line bg-surface text-ink"
                  : "self-end border-line bg-raised text-ink"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <strong className={`text-[9px] font-bold tracking-[0.12em] uppercase ${isAssistant ? "text-accent" : "text-muted"}`}>
                  {isAssistant ? "Kana" : "You"}
                </strong>
                <span className="text-[9px] tabular-nums text-faint">
                  {formatTime(message.timestamp)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{copy}</p>
            </article>
          );
        })}

        {busy ? (
          <div className="self-start border border-accent/30 bg-raised px-3 py-2 text-[10px] font-semibold text-accent">
            {status}
          </div>
        ) : null}
        <div aria-hidden="true" />
      </div>

      {!pinnedToBottom ? (
        <button
          type="button"
          onClick={() => {
            setPinnedToBottom(true);
            scrollToBottom();
          }}
          className="kana-focus absolute bottom-3 left-1/2 -translate-x-1/2 border border-line bg-raised px-3 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:text-accent"
          aria-label="Jump to latest message"
        >
          Latest
        </button>
      ) : null}
    </div>
  );
});
