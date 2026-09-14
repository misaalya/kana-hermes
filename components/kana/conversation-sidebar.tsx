"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { Conversation } from "@/lib/conversation/types";
import { CloseIcon, MoreIcon, PlusIcon, SearchIcon } from "./icons";
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
  const dateLocale = getCopy(locale).dateLocale;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(dateLocale, {
      month: "short", day: "numeric",
    }),
    [dateLocale],
  );
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

  // Close the row menu on any outside press or Escape.
  useEffect(() => {
    if (!menuId) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-conversation-menu]")) {
        setMenuId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuId(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuId]);

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

  const rowClass = (active: boolean) =>
    `kana-focus grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
      active ? "bg-surface-strong" : "hover:bg-surface-strong/60"
    }`;

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label={copy.aria}>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <h1 className="text-[15px] font-bold text-ink">{copy.title}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="kana-focus inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-semibold text-ink-dim transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCreate}
            disabled={disabled}
            aria-label={copy.newConversation}
          >
            <PlusIcon className="size-3.5" />
            <span>{copy.newLabel}</span>
          </button>
          {onClose ? (
            <button
              type="button"
              className="kana-focus grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-strong hover:text-ink"
              onClick={onClose}
              aria-label={copy.close}
            >
              <CloseIcon className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="px-4 pb-3 pt-1">
        <label className="relative block">
          <span className="sr-only">{copy.search}</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="kana-focus min-h-9 w-full rounded-lg border border-line-strong bg-raised pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <p className="px-3 pb-1.5 pt-1 text-[11px] text-faint">
          {query ? copy.found(visibleConversations.length) : copy.recent}
        </p>
        <div className="space-y-px">
          {visibleConversations.map((conversation) => {
            const latest = conversation.messages.at(-1);
            const preview =
              latest?.role === "assistant" ? latest.subtitle?.text : latest?.text;
            const active = conversation.id === activeId;
            const menuOpen = menuId === conversation.id;
            return (
              <article key={conversation.id} className="group relative" data-conversation-menu={menuOpen ? "" : undefined}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={disabled}
                  className={rowClass(active)}
                  aria-label={conversation.title}
                  aria-current={active ? "true" : undefined}
                >
                  <span className="min-w-0">
                    <span className={`block truncate text-[13px] text-ink ${active ? "font-semibold" : "font-medium"}`}>{conversation.title}</span>
                    <span className={`mt-0.5 block truncate text-[11.5px] ${conversation.agent?.status === "missing" ? "text-danger" : "text-muted"}`}>
                      {conversation.agent?.status === "missing"
                        ? copy.sessionUnavailable
                        : preview || copy.startMoment}
                    </span>
                  </span>
                  <span className={`pt-0.5 text-[11px] text-faint transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 ${menuOpen ? "opacity-0" : ""}`}>
                    {dateFormatter.format(conversation.updatedAt)}
                  </span>
                </button>

                <button
                  type="button"
                  className={`kana-focus absolute right-2 top-2 grid size-7 place-items-center rounded-md text-muted transition-opacity hover:bg-raised hover:text-ink focus:opacity-100 group-hover:opacity-100 ${menuOpen ? "bg-raised text-ink opacity-100" : "opacity-0"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuId(menuOpen ? null : conversation.id);
                  }}
                  aria-label={copy.moreOptions(conversation.title)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreIcon className="size-4" />
                </button>
                {menuOpen ? (
                  <div role="menu" className="kana-popover absolute right-2 top-10 z-10 min-w-32 rounded-lg border border-line-strong bg-raised p-1 animate-kana-in">
                    <button type="button" role="menuitem" className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-dim hover:bg-surface-strong hover:text-ink" onClick={() => rename(conversation)}>
                      {copy.rename}
                    </button>
                    <button type="button" role="menuitem" className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-danger/10" onClick={() => remove(conversation)}>
                      {copy.delete}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}

          {!visibleConversations.length ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[13px] font-medium text-ink-dim">{copy.noMatches}</p>
              <p className="mt-1 text-[11.5px] text-faint">{copy.noMatchesHint}</p>
            </div>
          ) : null}
        </div>

        {remoteOnly.length > 0 && onAdopt ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="px-3 pb-1.5 text-[11px] text-faint">
              {copy.availableFromHermes}
            </p>
            <div className="space-y-px">
              {remoteOnly.map((session) => (
                <button
                  key={session.hermesSessionKey}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAdopt(session)}
                  className={rowClass(false)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{session.title}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted">
                      {copy.messages(session.messageCount)} · {dateFormatter.format(session.lastActive * 1000)}
                    </span>
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
