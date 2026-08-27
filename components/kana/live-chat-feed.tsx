"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem } from "@/lib/state/use-kana-controller";
import type { KanaMessage } from "@/lib/conversation/types";
import { ActivityStack } from "./activity-stack";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

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
  locale: UiLocale;
};

type FeedEntry =
  | { kind: "message"; at: number; message: KanaMessage }
  | { kind: "activity"; at: number; activities: ActivityItem[] };

function formatTime(timestamp: number, locale: UiLocale): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
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
  locale,
}: LiveChatFeedProps) {
  const copy = getCopy(locale);
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
    <div className="kana-chat-feed relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="kana-chat-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        role="log"
        aria-live="polite"
        aria-label={copy.chat.aria}
      >
        {!entries.length && !busy ? (
          <div className="m-auto flex max-w-[280px] flex-col items-center py-12 text-center max-sm:hidden">
            <h2 className="text-sm font-bold text-ink">{copy.chat.emptyTitle}</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {copy.chat.emptyBody}
            </p>
          </div>
        ) : null}

        {entries.map((entry, index) => {
          if (entry.kind === "activity") {
            return <ActivityStack key={`activity-${index}`} activities={entry.activities} locale={locale} />;
          }
          const message = entry.message;
          const isAssistant = message.role === "assistant";
          const isSystem = message.role === "system";
          const messageCopy = isAssistant ? message.subtitle?.text : message.text;
          if (!messageCopy?.trim()) return null;

          if (isSystem) {
            return (
              <article key={message.id} className="rounded-xl border-2 border-line bg-raised px-3 py-2.5 max-sm:px-2.5 max-sm:py-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <strong className="text-[9px] font-bold tracking-[0.14em] text-muted uppercase">{copy.chat.hermesNote}</strong>
                  <span className="text-[9px] tabular-nums text-faint">{formatTime(message.timestamp, locale)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-dim max-sm:text-[10px]">{messageCopy}</p>
              </article>
            );
          }

          return (
            <article
              key={message.id}
              className={`max-w-[88%] rounded-2xl border-2 px-3.5 py-3 max-sm:max-w-[90%] max-sm:rounded-xl max-sm:px-2.5 max-sm:py-2 ${
                isAssistant
                  ? "kana-message-assistant self-start"
                  : "kana-message-user self-end"
              }`}
            >
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed max-sm:text-[11px] max-sm:leading-[1.5]">{messageCopy}</p>
              <span className="mt-1.5 block text-right text-[9px] tabular-nums opacity-50 max-sm:text-[8px]">
                {formatTime(message.timestamp, locale)}
              </span>
            </article>
          );
        })}

        {busy ? (
          <div className="self-start rounded-xl border-2 border-accent/45 bg-raised px-3 py-2 text-[10px] font-semibold text-accent">
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
          className="kana-focus absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl border-2 border-line-strong bg-raised px-3 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
          aria-label={copy.chat.latestAria}
        >
          {copy.chat.latest}
        </button>
      ) : null}
    </div>
  );
});
