import { useEffect, useRef } from "react";
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

export function DialogueHistory({ messages }: DialogueHistoryProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  return (
    <section className="dialogue-history" aria-label="Dialogue history">
      <div className="history-heading">
        <div>
          <h2>Conversation</h2>
          <p>Stored exactly as shown</p>
        </div>
        <span>{messages.length} messages</span>
      </div>

      <div className="message-list">
        {!messages.length ? (
          <div className="empty-history">
            <span aria-hidden="true">＊</span>
            <p>Your conversation will appear here.</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <article className={`message-row ${message.role}`} key={message.id}>
            <div className="message-meta">
              <strong>
                {message.role === "assistant"
                  ? "Kana"
                  : message.role === "system"
                    ? "Hermes"
                    : "You"}
              </strong>
              <span>{formatTime(message.timestamp)}</span>
            </div>
            <p>
              {message.role === "assistant"
                ? message.subtitle?.text
                : message.text}
            </p>
            {message.role === "assistant" && message.subtitle ? (
              <span className="language-badge">
                {message.subtitle.language.toUpperCase()} · {message.emotion || "neutral"}
              </span>
            ) : null}
            {message.role === "system" && message.command ? (
              <span className="command-badge">command result</span>
            ) : null}
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
