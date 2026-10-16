"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem } from "@/lib/agent/types";
import type { KanaMessage } from "@/lib/conversation/types";
import { ActivityStack } from "./activity-stack";
import { ChatMarkdown } from "./chat-markdown";
import { MediaAttachments } from "./media-attachments";
import { CheckIcon, CopyIcon } from "./icons";
import { extractMediaAttachments } from "@/lib/presentation/media";
import { getCopy, type Copy, type UiLocale } from "@/lib/ui/copy";
import {
  buildLiveFeedTimeline,
  type ServerActivityTurn,
} from "@/lib/conversation/live-feed-timeline";

type LiveChatFeedProps = {
  messages: KanaMessage[];
  activities: ActivityItem[];
  serverActivityTurns?: ServerActivityTurn[];
  /** Hermes is working or the reply's voice is still being generated. */
  typing: boolean;
  status: string;
  locale: UiLocale;
};

/** Hermes's reply: its Markdown, then any files it delivered. */
const AssistantReply = memo(function AssistantReply({ text, copy }: { text: string; copy: Copy["chat"] }) {
  const { text: markdown, attachments } = useMemo(() => extractMediaAttachments(text), [text]);
  return (
    <>
      {markdown ? <ChatMarkdown text={markdown} /> : null}
      <MediaAttachments attachments={attachments} copy={copy} />
    </>
  );
});

/**
 * What a bubble's copy button takes: the words on screen. A reply's MEDIA:
 * links render as players and download buttons, so the invisible links stay out
 * of the text the reader pastes somewhere else.
 */
function copyableText(role: KanaMessage["role"], shown: string): string {
  if (role !== "assistant") return shown;
  return extractMediaAttachments(shown).text || shown;
}

/**
 * One bubble's copy button. A refused clipboard — a plain-http LAN install has
 * none — selects the bubble's text instead, the same fallback the /docs code
 * block uses, so it never claims a copy that did not happen.
 */
const CopyMessageButton = memo(function CopyMessageButton({ text, copy, quiet = false }: {
  text: string;
  copy: Copy["chat"];
  /** The reader's own bubble: out of sight until that message is pointed at. */
  quiet?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyMessage = useCallback(
    async (button: HTMLButtonElement) => {
      try {
        const clipboard: Clipboard | undefined = navigator.clipboard;
        if (!clipboard?.writeText) throw new Error("The clipboard is unavailable.");
        await clipboard.writeText(text);
        setCopied(true);
      } catch {
        setCopied(false);
        const selection = button.closest("article")?.querySelector("[data-copy-text]");
        if (selection) window.getSelection()?.selectAllChildren(selection);
      }
    },
    [text],
  );

  return (
    <button
      type="button"
      aria-label={copied ? copy.copiedMessage : copy.copyMessage}
      aria-live="polite"
      onClick={(event) => void copyMessage(event.currentTarget)}
      className={`kana-focus grid size-5 shrink-0 place-items-center rounded-full text-muted transition-[color,opacity] hover:text-accent focus-visible:text-accent max-sm:size-6 ${
        quiet ? "kana-copy-quiet" : ""
      }`}
    >
      {copied ? (
        <CheckIcon className="size-3 max-sm:size-3.5 text-accent" />
      ) : (
        <CopyIcon className="size-3 max-sm:size-3.5" />
      )}
    </button>
  );
});

export const LiveChatFeed = memo(function LiveChatFeed({
  messages,
  activities,
  serverActivityTurns = [],
  typing,
  status,
  locale,
}: LiveChatFeedProps) {
  const copy = getCopy(locale);
  const dateLocale = copy.dateLocale;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(dateLocale, {
      hour: "2-digit", minute: "2-digit",
    }),
    [dateLocale],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const entries = useMemo(
    () => buildLiveFeedTimeline(messages, activities, serverActivityTurns),
    [messages, activities, serverActivityTurns],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  // New tools grow the open activity block without adding an entry.
  useEffect(() => {
    if (pinnedToBottom) scrollToBottom();
  }, [entries.length, activities.length, typing, pinnedToBottom, scrollToBottom]);

  // A delivered picture or video takes its height only once it loads, after
  // the reply already scrolled into view: follow it while pinned.
  const pinnedRef = useRef(pinnedToBottom);
  useEffect(() => {
    pinnedRef.current = pinnedToBottom;
  }, [pinnedToBottom]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const settle = () => {
      if (pinnedRef.current) scrollToBottom("auto");
    };
    // load and loadedmetadata do not bubble; listen in the capture phase.
    node.addEventListener("load", settle, true);
    node.addEventListener("loadedmetadata", settle, true);
    return () => {
      node.removeEventListener("load", settle, true);
      node.removeEventListener("loadedmetadata", settle, true);
    };
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setPinnedToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 32);
  }, []);

  return (
    // min-w-0: one long unbroken word must not widen the feed past the panel.
    <div className="kana-chat-feed relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="kana-chat-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        role="log"
        aria-live="polite"
        aria-label={copy.chat.aria}
      >
        {!entries.length && !typing ? (
          <div className="m-auto flex max-w-[280px] flex-col items-center py-12 text-center max-sm:hidden">
            <h2 className="text-base font-extrabold text-ink">{copy.chat.emptyTitle}</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {copy.chat.emptyBody}
            </p>
          </div>
        ) : null}

        {entries.map((entry) => {
          if (entry.kind === "activity") {
            return <ActivityStack key={entry.key} activities={entry.activities} live={entry.live} locale={locale} />;
          }
          const message = entry.message;
          const isAssistant = message.role === "assistant";
          const isSystem = message.role === "system";
          const messageCopy = isAssistant ? message.subtitle?.text : message.text;
          if (!messageCopy?.trim()) return null;

          if (isSystem) {
            return (
              <article key={message.id} className="rounded-[22px] border-2 border-line bg-raised px-4 py-2.5 max-sm:px-3 max-sm:py-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <strong className="kana-label-bubble">{copy.chat.hermesNote}</strong>
                  <span className="text-[11px] tabular-nums text-faint">{dateFormatter.format(message.timestamp)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-dim [overflow-wrap:anywhere] max-sm:text-[13px]">{messageCopy}</p>
              </article>
            );
          }

          return (
            <article
              key={message.id}
              className={`flex min-w-0 max-w-[88%] flex-col gap-1.5 max-sm:max-w-[90%] ${
                isAssistant ? "self-start" : "self-end"
              }`}
            >
              <div
                className={`rounded-[24px] border-2 px-4 py-3 max-sm:rounded-[20px] max-sm:px-3 max-sm:py-2 ${
                  isAssistant ? "kana-message-assistant" : "kana-message-user"
                }`}
              >
                <div className="text-[13px] font-medium leading-relaxed max-sm:text-[13px] max-sm:leading-[1.5]" data-copy-text="">
                  {isAssistant ? (
                    <AssistantReply text={messageCopy} copy={copy.chat} />
                  ) : (
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{messageCopy}</p>
                  )}
                </div>
              </div>
              {/* Under the bubble, never in it: the message is all the fill
                  holds. A reply's actions start at its left edge, the reader's
                  own at its right, so each row sits on its own side. */}
              <div
                className={`flex items-center gap-1 text-muted ${
                  isAssistant ? "justify-start pl-1" : "justify-end pr-1"
                }`}
              >
                <CopyMessageButton
                  text={copyableText(message.role, messageCopy)}
                  copy={copy.chat}
                  quiet={!isAssistant}
                />
                <span className="text-[11px] tabular-nums opacity-70 max-sm:text-[10px]">
                  {dateFormatter.format(message.timestamp)}
                </span>
              </div>
            </article>
          );
        })}

        {typing ? (
          <div className="flex flex-col items-start gap-1 self-start">
            <span className="kana-typing kana-message-assistant" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="pl-1 text-[10px] font-bold text-muted">{status}</span>
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
          className="kana-focus kana-pill kana-pill-accent absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 text-[11px]"
          aria-label={copy.chat.latestAria}
        >
          {copy.chat.latest}
        </button>
      ) : null}
    </div>
  );
});
