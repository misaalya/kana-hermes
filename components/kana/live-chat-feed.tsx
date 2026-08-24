"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem } from "@/lib/state/use-kana-controller";
import type { KanaMessage } from "@/lib/conversation/types";
import { ActivityStack } from "./activity-stack";

type ServerActivityTurn = {
  turnAnchorMs: number;
  activities: ActivityItem[];
};

type LiveChatFeedProps = {
  messages: KanaMessage[];
  activities: ActivityItem[];
  /** Stored per-turn logs from the server-side store (cross-browser). */
  serverActivityTurns?: ServerActivityTurn[];
  busy: boolean;
  status: string;
};

type FeedEntry =
  | { kind: "message"; at: number; message: KanaMessage }
  | { kind: "activity"; at: number; activities: ActivityItem[] };

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

/**
 * Live-chat feed, vtuber-stream style.
 *
 * One chronological column anchored to the LEFT edge of the avatar stage:
 * the user's message, the tool activity lines it produced (in run order),
 * then Kana's reply — newest at the bottom, auto-scrolling as new entries
 * land. The column is height-capped with its own scroll so a long reply
 * never covers the avatar: the stage stays fully visible behind it.
 *
 * Auto-scroll pauses while the viewer is scrolled up reading history and
 * resumes on "jump to latest".
 */
export const LiveChatFeed = memo(function LiveChatFeed({
  messages,
  activities,
  serverActivityTurns = [],
  busy,
  status,
}: LiveChatFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Merge persisted messages and activity logs into one chronological
  // timeline. Sources, deduped by turn anchor:
  // - assistant messages carry their turn's activities (IndexedDB snapshot);
  // - server turns carry the same logs cross-browser. A server turn whose
  //   anchor matches a message's timestamp is skipped — the message already
  //   has the log;
  // - live activities attach after the last user message (running turn).
  const entries = useMemo<FeedEntry[]>(() => {
    const timeline: FeedEntry[] = [];
    // Restored tool history comes from ONE source only: the server store
    // (cross-browser, anchored to each assistant reply's Hermes timestamp).
    // message.activities is the PUT payload that feeds that store — never a
    // second render source, or every restored turn renders twice (once above,
    // once below Kana's reply).
    for (const message of messages) {
      if (message.role !== "system") {
        timeline.push({ kind: "message", at: message.timestamp, message });
      }
    }
    for (const turn of serverActivityTurns) {
      if (!turn.activities.length) continue;
      timeline.push({
        kind: "activity",
        at: turn.turnAnchorMs,
        activities: turn.activities,
      });
    }
    if (activities.length) {
      const lastUser = [...timeline]
        .reverse()
        .find((entry) => entry.kind === "message" && entry.message.role === "user");
      const attachAt = (lastUser?.at ?? 0) + 0.5;
      timeline.push({ kind: "activity", at: attachAt, activities });
    }
    return timeline.sort((a, b) => a.at - b.at);
  }, [messages, activities, serverActivityTurns]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (pinnedToBottom) scrollToBottom();
  }, [entries.length, pinnedToBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinnedToBottom(distance < 24);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col justify-end">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pb-2 [scrollbar-width:thin]"
        role="log"
        aria-live="polite"
        aria-label="Live chat"
      >
        {!entries.length && !busy ? (
          <p className="self-start rounded-2xl bg-surface/80 px-3 py-2 text-[11px] text-faint backdrop-blur">
            Say something to Kana — the stream starts here.
          </p>
        ) : null}

        {entries.map((entry, index) => {
          if (entry.kind === "activity") {
            return <ActivityStack key={`act-${index}`} activities={entry.activities} />;
          }
          const message = entry.message;
          if (message.role === "assistant") {
            const subtitle = message.subtitle?.text?.trim();
            if (!subtitle) return null;
            return (
              <article
                key={message.id}
                className="max-w-[min(92%,460px)] self-start rounded-2xl rounded-bl-md border border-line bg-surface/95 px-3.5 py-2.5 shadow-sm backdrop-blur"
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <strong className="text-[10px] font-bold tracking-wider text-accent-strong uppercase">Kana</strong>
                  {message.emotion ? (
                    <span className="rounded-md border border-line px-1.5 py-px text-[8px] font-bold tracking-wider text-muted uppercase">
                      {message.emotion}
                    </span>
                  ) : null}
                  <span className="text-[9px] tabular-nums text-faint">{formatTime(message.timestamp)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{subtitle}</p>
              </article>
            );
          }
          return (
            <article
              key={message.id}
              className="max-w-[min(92%,420px)] self-start rounded-2xl rounded-bl-md border border-accent/25 bg-accent/10 px-3.5 py-2 backdrop-blur"
            >
              <div className="mb-0.5 flex items-center gap-1.5">
                <strong className="text-[10px] font-bold tracking-wider text-ink-dim uppercase">You</strong>
                <span className="text-[9px] tabular-nums text-faint">{formatTime(message.timestamp)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{message.text}</p>
            </article>
          );
        })}

        {busy ? (
          <p className="flex items-center gap-1.5 self-start rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[10px] font-semibold text-ink-dim backdrop-blur">
            <span className="size-1.5 animate-kana-pulse rounded-full bg-accent-strong" />
            {status}
          </p>
        ) : null}
        <div ref={(node) => { if (node && pinnedToBottom) node.scrollIntoView({ block: "end" }); }} />
      </div>

      {!pinnedToBottom ? (
        <button
          type="button"
          onClick={() => {
            setPinnedToBottom(true);
            scrollToBottom();
          }}
          className="self-start rounded-lg border border-line bg-raised px-2.5 py-1 text-[10px] font-semibold text-muted shadow-sm transition-colors hover:border-accent hover:text-accent-strong"
        >
          ↓ Jump to latest
        </button>
      ) : null}
    </div>
  );
});
