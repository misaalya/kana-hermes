import { memo, useEffect, useRef } from "react";
import type { KanaMessage } from "@/lib/conversation/types";

type DialogueHistoryProps = {
  messages: KanaMessage[];
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

/**
 * Memoized: the message list can be long, and the composer draft state above it
 * changes on every keystroke. The stored history itself only changes when a
 * turn produces new messages.
 */
export const DialogueHistory = memo(function DialogueHistory({ messages }: DialogueHistoryProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <h2 className="text-sm font-bold text-ink">Conversation</h2>
        <span className="text-[11px] text-faint">{messages.length} messages</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {!messages.length ? (
          <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-line py-10 text-center">
            <span aria-hidden="true" className="text-lg text-faint">＊</span>
            <p className="text-xs text-muted">Your conversation will appear here.</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[92%] rounded-2xl border px-3.5 py-2.5 ${
              message.role === "assistant"
                ? "self-start border-line bg-surface"
                : message.role === "system"
                  ? "self-start border-dashed border-line bg-transparent"
                  : "self-end border-accent/30 bg-accent/10"
            }`}
          >
            <div className="mb-0.5 flex items-center gap-2">
              <strong className="text-[11px] font-bold tracking-wide text-ink">
                {message.role === "assistant"
                  ? "Kana"
                  : message.role === "system"
                    ? "Hermes"
                    : "You"}
              </strong>
              <span className="text-[10px] text-faint">{formatTime(message.timestamp)}</span>
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
              {message.role === "assistant"
                ? message.subtitle?.text
                : message.text}
            </p>
            {message.role === "assistant" && message.subtitle ? (
              <span className="mt-1 inline-block rounded-full border border-line bg-bg px-2 py-0.5 text-[9px] font-bold tracking-wider text-muted uppercase">
                {message.subtitle.language} · {message.emotion || "neutral"}
              </span>
            ) : null}
            {message.role === "system" && message.command ? (
              <span className="mt-1 inline-block rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[9px] font-bold tracking-wider text-muted uppercase">
                command result
              </span>
            ) : null}
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
});
