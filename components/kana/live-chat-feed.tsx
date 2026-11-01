"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem } from "@/lib/agent/types";
import type { KanaMessage } from "@/lib/conversation/types";
import { ActivityStack } from "./activity-stack";
import { ChatMarkdown } from "./chat-markdown";
import { MediaAttachments } from "./media-attachments";
import { CheckIcon, CopyIcon, RedirectIcon, StopIcon } from "./icons";
import { Toggle } from "./ui";
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
  /** Provisional answer body while focus mode with the voice off streams it. */
  streamingReply?: string | null;
  locale: UiLocale;
  /** Stop the running turn, or release a reply whose voice is still coming. */
  onStop?: () => void;
  /** Follow new entries; the feed's own switch writes it, not Settings. */
  autoScroll?: boolean;
  onToggleAutoScroll?: () => void;
};

/** Hermes's reply: its Markdown, then any files it delivered. */
const AssistantReply = memo(function AssistantReply({ text, copy, locale }: { text: string; copy: Copy["chat"]; locale: UiLocale }) {
  const { text: markdown, attachments } = useMemo(() => extractMediaAttachments(text), [text]);
  return (
    <>
      {markdown ? <ChatMarkdown text={markdown} locale={locale} /> : null}
      <MediaAttachments attachments={attachments} copy={copy} />
    </>
  );
});

/** The empty conversation's face. Its eye slots keep one width, so closing the
    eyes to bullets never changes the spacing of the rest of the line. */
function KanaEmptyFace() {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let close: number | undefined;
    const timer = window.setInterval(() => {
      setBlink(true);
      close = window.setTimeout(() => setBlink(false), 220);
    }, 6000);
    return () => {
      window.clearInterval(timer);
      if (close !== undefined) window.clearTimeout(close);
    };
  }, []);
  return (
    <span className="kana-empty-face" aria-hidden="true">
      {"(๑ "}
      <span className="kana-empty-eye">{blink ? "•" : ">"}</span>
      {" ᴗ "}
      <span className="kana-empty-eye">{blink ? "•" : "<"}</span>
      {" ๑)"}
    </span>
  );
}

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
  streamingReply = null,
  locale,
  onStop,
  autoScroll = true,
  onToggleAutoScroll,
}: LiveChatFeedProps) {
  const auto = autoScroll !== false;
  const copy = getCopy(locale);
  const dateFormatter = new Intl.DateTimeFormat(copy.dateLocale, {
    hour: "2-digit", minute: "2-digit",
  });
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
    if (auto && pinnedToBottom) scrollToBottom();
  }, [entries.length, activities.length, typing, streamingReply, pinnedToBottom, auto, scrollToBottom]);

  // Turning auto-scroll back on returns to the latest entry at once.
  useEffect(() => {
    if (!auto) return;
    scrollToBottom();
  }, [auto, scrollToBottom]);

  // Sending a message returns to the latest entry, even when the reader had
  // scrolled up; a reply that arrives while reading above does not pull the
  // view. With auto-scroll off, the reader stays where they are.
  const lastUserKey = useMemo(() => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.kind === "message" && entry.message.role === "user") return entry.message.id;
    }
    return null;
  }, [entries]);
  const lastUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastUserKey || lastUserRef.current === lastUserKey) return;
    const first = lastUserRef.current === null;
    lastUserRef.current = lastUserKey;
    if (first || !auto) return;
    scrollToBottom();
  }, [lastUserKey, auto, scrollToBottom]);

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
  }, [setPinnedToBottom]);

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
            <KanaEmptyFace />
            <p className="sr-only">{copy.chat.emptyBody}</p>
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
          const corrections = entry.corrections ?? [];
          if (!messageCopy?.trim()) return null;

          if (isSystem) {
            return (
              <article key={message.id} className="px-1 py-0.5">
                <div className="flex items-center gap-2.5">
                  <strong className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted">{copy.chat.hermesNote}</strong>
                  <span aria-hidden="true" className="min-w-0 flex-1 border-t-2 border-dotted border-line-strong" />
                  <span className="shrink-0 text-[10px] tabular-nums text-faint">{dateFormatter.format(message.timestamp)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-dim [overflow-wrap:anywhere] max-sm:text-[13px]">{messageCopy}</p>
              </article>
            );
          }

          return (
            <article
              key={message.id}
              data-role={message.role}
              className={`flex min-w-0 max-w-[88%] flex-col gap-1.5 max-sm:max-w-[90%] ${
                isAssistant ? "self-start" : "self-end"
              }`}
            >
              <div
                className={`rounded-[24px] border-2 px-4 py-3 max-sm:rounded-[20px] max-sm:px-3 max-sm:py-2 ${
                  isAssistant ? "kana-message-assistant" : "kana-message-user"
                }`}
              >
                <div className="kana-message-text text-[13px] font-medium leading-relaxed max-sm:text-[13px] max-sm:leading-[1.5]" data-copy-text="">
                  {isAssistant ? (
                    <AssistantReply text={messageCopy} copy={copy.chat} locale={locale} />
                  ) : (
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{messageCopy}</p>
                  )}
                </div>
              </div>
              {corrections.length ? (
                // A message Hermes folded into this turn: a branch under the
                // bubble that opened it, the same line the Hermes TUI prints.
                <div className="flex flex-col items-end gap-0.5 pr-1">
                  {corrections.map((correction) => (
                    <p
                      key={correction.id}
                      data-correction={correction.correction}
                      className="flex max-w-full items-start justify-end gap-1.5 text-[11px] leading-relaxed text-muted max-sm:text-[11px]"
                    >
                      <RedirectIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span className="whitespace-pre-wrap text-right [overflow-wrap:anywhere]">
                        {correction.correction === "steered"
                          ? copy.chat.correctionSteered(correction.text ?? "")
                          : copy.chat.correctionRedirected(correction.text ?? "")}
                      </span>
                    </p>
                  ))}
                </div>
              ) : null}
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

        {/* Provisional text: done once, the final message is announced. */}
        {typing && streamingReply?.trim() ? (
          <article
            data-role="assistant"
            data-streaming="true"
            aria-hidden="true"
            className="flex min-w-0 max-w-[88%] flex-col gap-1.5 self-start max-sm:max-w-[90%]"
          >
            <div className="rounded-[24px] border-2 px-4 py-3 kana-message-assistant max-sm:rounded-[20px] max-sm:px-3 max-sm:py-2">
              <div className="kana-message-text kana-streaming-body text-[13px] font-medium leading-relaxed max-sm:text-[13px] max-sm:leading-[1.5]">
                <ChatMarkdown text={streamingReply} streaming locale={locale} />
              </div>
            </div>
          </article>
        ) : null}

        {typing ? (
          <div className="flex flex-col items-start gap-1 self-start">
            <span className="kana-typing kana-message-assistant" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <div className="flex items-center gap-2 pl-1">
              {/* The dots and Stop carry the state visually; keep the status
                  text available to screen readers without a visible label. */}
              <span className="sr-only">{status}</span>
              {onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label={copy.workspace.stop}
                  className="kana-focus kana-typing-stop inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-muted transition-colors hover:bg-white/16 hover:text-accent"
                >
                  <StopIcon className="size-3" />
                  {copy.workspace.stop}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div aria-hidden="true" />
      </div>

      {!pinnedToBottom || !auto ? (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          {!pinnedToBottom ? (
            <button
              type="button"
              onClick={() => {
                setPinnedToBottom(true);
                scrollToBottom();
              }}
              className="kana-focus kana-pill kana-pill-accent shrink-0 whitespace-nowrap px-4 py-1.5 text-[11px]"
              aria-label={copy.chat.latestAria}
            >
              {copy.chat.latest}
            </button>
          ) : null}
          {onToggleAutoScroll ? (
            <div className="kana-pill shrink-0 gap-2 whitespace-nowrap border border-line bg-surface px-3 py-1 text-[11px] text-ink">
              <span>{copy.chat.autoScroll}</span>
              <Toggle checked={auto} label={copy.chat.autoScroll} onChange={onToggleAutoScroll} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
