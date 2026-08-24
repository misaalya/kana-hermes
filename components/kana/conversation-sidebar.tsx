import { memo, useMemo, useState } from "react";
import type { Conversation } from "@/lib/conversation/types";

export type HermesSessionEntry = {
  hermesSessionKey: string;
  title: string;
  messageCount: number;
  startedAt: number;
};

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeId?: string;
  disabled?: boolean;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onClose?: () => void;
  /** Kana sessions known to Hermes but not present in this browser. */
  hermesSessions?: HermesSessionEntry[];
  /** Opens (imports) a Hermes-only session into this browser. */
  onAdopt?(hermesSessionKey: string, title: string): void;
};

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

/**
 * Memoized: the conversation list is not affected by composer typing, but it
 * re-renders with the whole shell on every keystroke unless isolated.
 */
export const ConversationSidebar = memo(function ConversationSidebar({
  conversations,
  activeId,
  disabled,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onClose,
  hermesSessions = [],
  onAdopt,
}: ConversationSidebarProps) {
  // Hermes sessions this browser has not adopted yet (no local record).
  const localKeys = useMemo(
    () =>
      new Set(
        conversations
          .map((c) => c.agent?.persistentSessionId)
          .filter(Boolean) as string[],
      ),
    [conversations],
  );
  const remoteOnly = hermesSessions.filter(
    (session) => !localKeys.has(session.hermesSessionKey),
  );
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
    <aside className="flex h-full min-h-0 flex-col gap-3" aria-label="Conversation history">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-ink">Kana</h1>
          <p className="text-[10px] tracking-wide text-muted uppercase">Hermes interface</p>
        </div>
        {onClose ? (
          <button type="button" className="text-lg leading-none text-muted transition-colors hover:text-accent-strong" onClick={onClose} aria-label="Close history">
            ×
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-accent text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onCreate}
        disabled={disabled}
      >
        <span aria-hidden="true">＋</span>
        New conversation
      </button>

      <label className="relative block">
        <span className="sr-only">Search conversations</span>
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search history"
          className="min-h-9 w-full rounded-full border border-line-strong bg-transparent pl-8 pr-3 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <p className="px-1 pb-2 text-[10px] font-bold tracking-wider text-faint uppercase">
          {query ? `${visibleConversations.length} found` : "Recent"}
        </p>
        <div className="flex flex-col gap-1.5">
          {visibleConversations.map((conversation) => {
            const latest = conversation.messages.at(-1);
            const preview =
              latest?.role === "assistant"
                ? latest.subtitle?.text
                : latest?.text;
            const active = conversation.id === activeId;

            return (
              <article key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={disabled}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    active
                      ? "border-accent/40 bg-accent/10"
                      : "border-line bg-surface hover:border-line-strong"
                  }`}
                >
                  <span className="block truncate pr-14 text-xs font-semibold text-ink">{conversation.title}</span>
                  {conversation.agent ? (
                    <span
                      className={`mt-0.5 inline-block rounded-full border px-1.5 py-px text-[9px] font-bold tracking-wide uppercase ${
                        conversation.agent.status === "missing"
                          ? "border-danger/40 text-danger"
                          : "border-line-strong text-muted"
                      }`}
                    >
                      {conversation.agent.status === "missing"
                        ? "Session missing"
                        : conversation.agent.relationship === "branch"
                          ? "Hermes branch"
                          : "Hermes linked"}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {preview || "A quiet new beginning"}
                  </span>
                  <span className="absolute right-3 top-2.5 text-[10px] text-faint">{formatDate(conversation.updatedAt)}</span>
                </button>
                <div className={`absolute bottom-2 right-2 flex gap-1 ${active ? "" : "hidden group-hover:flex"}`}>
                  <button
                    type="button"
                    className="rounded-full border border-line-strong bg-raised px-2 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:text-accent-strong"
                    onClick={() => rename(conversation)}
                    aria-label={`Rename ${conversation.title}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-line-strong bg-raised px-2 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:text-danger"
                    onClick={() => remove(conversation)}
                    aria-label={`Delete ${conversation.title}`}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
          {!visibleConversations.length ? (
            <p className="rounded-xl border border-dashed border-line py-6 text-center text-[11px] text-faint">
              No matching conversations.
            </p>
          ) : null}
        </div>

        {remoteOnly.length > 0 && onAdopt ? (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <p className="px-1 pb-1 text-[10px] font-bold tracking-wider text-faint uppercase">
              Di Hermes — belum dibuka di browser ini
            </p>
            {remoteOnly.map((session) => (
              <button
                key={session.hermesSessionKey}
                type="button"
                disabled={disabled}
                onClick={() => onAdopt(session.hermesSessionKey, session.title)}
                className="w-full rounded-xl border border-dashed border-line-strong px-3 py-2 text-left transition-colors hover:border-accent disabled:opacity-50"
              >
                <span className="block truncate pr-14 text-xs font-semibold text-ink">
                  {session.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted">
                  {session.messageCount} pesan · {formatDate(session.startedAt * 1000)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-3 text-[10px] text-faint">
        <span className="size-1.5 rounded-full bg-accent/70" />
        History stays on this device
      </div>
    </aside>
  );
});
