"use client";

import { memo, useMemo, useState } from "react";
import type { Conversation } from "@/lib/conversation/types";
import { CloseIcon } from "./icons";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

export type HermesSessionEntry = {
  hermesSessionKey: string;
  title: string;
  messageCount: number;
  startedAt: number;
  lastActive: number;
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
  hermesSessions?: HermesSessionEntry[];
  onAdopt?(session: HermesSessionEntry): void;
  locale: UiLocale;
};

function formatDate(timestamp: number, locale: UiLocale): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

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
  locale,
}: ConversationSidebarProps) {
  const copy = getCopy(locale).history;
  const localKeys = useMemo(
    () =>
      new Set(
        conversations
          .map((conversation) => conversation.agent?.persistentSessionId)
          .filter(Boolean) as string[],
      ),
    [conversations],
  );
  const remoteOnly = hermesSessions.filter(
    (session) => !localKeys.has(session.hermesSessionKey),
  );
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
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
    setMenuId(null);
    const title = window.prompt(copy.renamePrompt, conversation.title);
    if (title?.trim()) onRename(conversation.id, title);
  };

  const remove = (conversation: Conversation) => {
    setMenuId(null);
    if (window.confirm(copy.deleteConfirm(conversation.title))) {
      onDelete(conversation.id);
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label={copy.aria}>
      <header className="flex items-center justify-between border-b-2 border-line px-5 py-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-muted uppercase">{copy.eyebrow}</p>
          <h1 className="mt-0.5 text-lg font-bold text-ink">{copy.title}</h1>
        </div>
        {onClose ? (
          <button
            type="button"
            className="kana-focus grid size-10 place-items-center rounded-xl border-2 border-line-strong bg-surface text-muted transition-colors hover:border-accent hover:text-ink"
            onClick={onClose}
            aria-label={copy.close}
          >
            <CloseIcon className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="flex items-center gap-2 px-4 py-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{copy.search}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="kana-focus min-h-10 w-full rounded-xl border-2 border-line bg-surface-strong px-3 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <button
          type="button"
          className="kana-focus min-h-10 shrink-0 rounded-xl border-2 border-accent bg-accent px-3 text-[11px] font-bold text-on-accent transition-colors hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed"
          onClick={onCreate}
          disabled={disabled}
          aria-label={copy.newConversation}
        >
          {copy.newLabel}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-2 pt-1 text-[9px] font-bold tracking-[0.16em] text-faint uppercase">
          {query ? copy.found(visibleConversations.length) : copy.recent}
        </p>
        <div className="space-y-1">
          {visibleConversations.map((conversation) => {
            const latest = conversation.messages.at(-1);
            const preview =
              latest?.role === "assistant" ? latest.subtitle?.text : latest?.text;
            const active = conversation.id === activeId;
            return (
              <article key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={disabled}
                  className={`kana-focus grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    active ? "border-accent bg-accent/12" : "border-transparent hover:border-line hover:bg-surface-strong"
                  }`}
                  aria-label={conversation.title}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-ink">{conversation.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">
                      {conversation.agent?.status === "missing"
                        ? copy.sessionUnavailable
                        : preview || copy.startMoment}
                    </span>
                  </span>
                  <span className="self-start pt-1 text-[9px] text-faint">{formatDate(conversation.updatedAt, locale)}</span>
                </button>

                <button
                  type="button"
                  className="kana-focus absolute bottom-1.5 right-2 px-1.5 py-1 text-[9px] font-semibold text-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuId(menuId === conversation.id ? null : conversation.id);
                  }}
                  aria-label={copy.moreOptions(conversation.title)}
                >
                  {copy.more}
                </button>
                {menuId === conversation.id ? (
                  <div className="kana-panel absolute bottom-9 right-2 z-10 min-w-28 rounded-xl p-1 animate-kana-in">
                    <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-semibold text-ink-dim hover:bg-surface-strong" onClick={() => rename(conversation)}>
                      {copy.rename}
                    </button>
                    <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-semibold text-danger hover:bg-danger/10" onClick={() => remove(conversation)}>
                      {copy.delete}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}

          {!visibleConversations.length ? (
            <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
              <p className="text-xs font-semibold text-muted">{copy.noMatches}</p>
              <p className="mt-1 text-[10px] text-faint">{copy.noMatchesHint}</p>
            </div>
          ) : null}
        </div>

        {remoteOnly.length > 0 && onAdopt ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="px-2 pb-2 text-[9px] font-bold tracking-[0.16em] text-faint uppercase">
              {copy.availableFromHermes}
            </p>
            <div className="space-y-1">
              {remoteOnly.map((session) => (
                <button
                  key={session.hermesSessionKey}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAdopt(session)}
                  className="kana-focus w-full rounded-xl border-2 border-transparent px-3 py-2.5 text-left transition-colors hover:border-line hover:bg-surface-strong disabled:opacity-50"
                >
                  <span className="block truncate text-xs font-bold text-ink">{session.title}</span>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {copy.messages(session.messageCount)} · {formatDate(session.lastActive * 1000, locale)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

    </aside>
  );
});
