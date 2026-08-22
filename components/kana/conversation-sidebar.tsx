import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/conversation/types";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeId?: string;
  disabled?: boolean;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onClose?: () => void;
};

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export function ConversationSidebar({
  conversations,
  activeId,
  disabled,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onClose,
}: ConversationSidebarProps) {
  const [query, setQuery] = useState("");
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((conversation) => {
      if (conversation.title.toLocaleLowerCase().includes(normalized)) return true;
      return conversation.messages.some((message) =>
        [message.text, message.subtitle?.text, message.speech_ja]
          .filter(Boolean)
          .some((text) => text?.toLocaleLowerCase().includes(normalized)),
      );
    });
  }, [conversations, query]);

  const rename = (conversation: Conversation) => {
    const title = window.prompt("Rename conversation", conversation.title);
    if (title?.trim()) onRename(conversation.id, title);
  };

  const remove = (conversation: Conversation) => {
    if (window.confirm(`Delete “${conversation.title}” from Kana history?`)) {
      onDelete(conversation.id);
    }
  };

  return (
    <aside className="conversation-sidebar" aria-label="Conversation history">
      <div className="sidebar-brand">
        <div className="kana-mark" aria-hidden="true">
          か
        </div>
        <div>
          <h1>Kana</h1>
          <p>Hermes interface</p>
        </div>
        {onClose ? (
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close history">
            ×
          </button>
        ) : null}
      </div>

      <button className="new-conversation-button" onClick={onCreate} disabled={disabled}>
        <span aria-hidden="true">＋</span>
        New conversation
      </button>

      <label className="conversation-search">
        <span className="sr-only">Search conversations</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search history"
        />
      </label>

      <div className="conversation-list">
        <p className="section-label">
          {query ? `${visibleConversations.length} found` : "Recent"}
        </p>
        {visibleConversations.map((conversation) => {
          const latest = conversation.messages.at(-1);
          const preview =
            latest?.role === "assistant"
              ? latest.subtitle?.text
              : latest?.text;

          return (
            <article
              className={`conversation-item ${conversation.id === activeId ? "active" : ""}`}
              key={conversation.id}
            >
              <button
                className="conversation-select"
                onClick={() => onSelect(conversation.id)}
                disabled={disabled}
              >
                <span className="conversation-title">{conversation.title}</span>
                {conversation.agent ? (
                  <span
                    className={`conversation-session ${
                      conversation.agent.status === "missing" ? "missing" : "linked"
                    }`}
                  >
                    {conversation.agent.status === "missing"
                      ? "Session missing"
                      : conversation.agent.relationship === "branch"
                        ? "Hermes branch"
                        : "Hermes linked"}
                  </span>
                ) : null}
                <span className="conversation-preview">
                  {preview || "A quiet new beginning"}
                </span>
                <span className="conversation-date">{formatDate(conversation.updatedAt)}</span>
              </button>
              <div className="conversation-actions">
                <button onClick={() => rename(conversation)} aria-label={`Rename ${conversation.title}`}>
                  Rename
                </button>
                <button onClick={() => remove(conversation)} aria-label={`Delete ${conversation.title}`}>
                  Delete
                </button>
              </div>
            </article>
          );
        })}
        {visibleConversations.length === 0 ? (
          <p className="conversation-empty">No matching conversations.</p>
        ) : null}
      </div>

      <div className="sidebar-note">
        <span className="note-dot" />
        History stays on this device
      </div>
    </aside>
  );
}
