"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { KanaMessage } from "@/lib/conversation/types";
import { selectActiveConversation } from "@/lib/store/conversation-store";
import { getCopy } from "@/lib/ui/copy";
import { fadeAvatarModeChange } from "./avatar-mode-transition";
import { ChatComposer } from "./chat-composer";
import { FocusRail } from "./focus-rail";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { LiveChatFeed } from "./live-chat-feed";
import { useChatVisible } from "./workspace-stage";

const NO_MESSAGES: KanaMessage[] = [];
const CHAT_MIN_WIDTH = 390;
/** The settled maximum is 70% of the screen; a drag may overshoot to 90%. */
const CHAT_MAX_SHARE = 0.7;
const CHAT_DRAG_MAX_SHARE = 0.9;
/** Past this width the transcript keeps a focus-mode reading measure. */
const CHAT_WIDE_WIDTH = 900;
/** Holding the frame at 90% for this long enters focus mode. */
const CHAT_AUTO_FOCUS_HOLD_MS = 500;

/** The same viewport bounds the CSS clamp uses for the dock. */
function resizeBounds(): { min: number; max: number } {
  const min = Math.min(Math.max(CHAT_MIN_WIDTH, window.innerWidth * 0.34), 480);
  return { min, max: Math.max(min, window.innerWidth * CHAT_MAX_SHARE) };
}

function ChatFeed() {
  const workspace = useKanaWorkspace();
  const messages = useKanaStore("conversations", (state) => selectActiveConversation(state)?.messages ?? NO_MESSAGES);
  const activities = useKanaStore("activity", (state) => state.activities);
  const serverActivityTurns = useKanaStore("activity", (state) => state.serverActivityTurns);
  const busy = useKanaStore("agentSession", (state) => state.busy);
  const status = useKanaStore("agentSession", (state) => state.status);
  const streamingReply = useKanaStore("agentSession", (state) => state.streamingReply);
  // Speech is synthesized before the reply text is revealed, which can take a
  // while on slower machines: keep the typing bubble up until it plays.
  const synthesizing = useKanaStore("voice", (state) => state.runtimeState === "synthesizing");
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const stop = useCallback(() => void workspace.actions.abort(), [workspace.actions]);
  return (
    <LiveChatFeed
      messages={messages}
      activities={activities}
      serverActivityTurns={serverActivityTurns}
      typing={busy || synthesizing}
      status={status}
      streamingReply={streamingReply}
      locale={locale}
      onStop={stop}
    />
  );
}

export function ChatDock() {
  const workspace = useKanaWorkspace();
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const locale = preferences.uiLocale;
  const chatVisible = useChatVisible();
  const greeting = useKanaStore("workspace", (state) => state.greeting);
  // Without the avatar there is nothing left to hide; desktop adds the focus
  // rail beside the conversation.
  const avatarVisible = preferences.avatarVisible;
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  const text = getCopy(locale).workspace;
  const showRail = !avatarVisible && !usesMobileChat;
  const panelRef = useRef<HTMLElement>(null);

  // Avatar mode's dock can be dragged wider, up to a viewport-safe maximum.
  const resizable = avatarVisible && !usesMobileChat;
  // A drag is local until it settles, then the stored preference takes over.
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null);
  const width = draggedWidth ?? (preferences.chatPanelWidth > 0 ? preferences.chatPanelWidth : null);
  const widthRef = useRef<number | null>(preferences.chatPanelWidth > 0 ? preferences.chatPanelWidth : null);
  const [resizing, setResizing] = useState(false);
  const [wide, setWide] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  const holdTimer = useRef<number | null>(null);
  const saveSequence = useRef(0);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const enterAutoFocus = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setResizing(false);
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    animation.current?.cancel();
    animation.current = null;
    fadeAvatarModeChange(() => {
      void workspace.actions.savePreferences({
        ...workspace.stores.preferences.getState().preferences,
        avatarVisible: false,
      });
    });
  }, [workspace]);

  const paintWidth = useCallback((value: number) => {
    dockRef.current?.style.setProperty("--kana-chat-width", `${value}px`);
  }, []);

  /** Paint the settled width and ease the panel back from an oversized drag. */
  const settleWidth = useCallback((value: number) => {
    const dock = dockRef.current;
    if (!dock) return;
    const from = dock.getBoundingClientRect().width;
    animation.current?.cancel();
    animation.current = null;
    paintWidth(value);
    if (
      Math.abs(from - value) < 0.5
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    animation.current = dock.animate(
      [{ width: `${from}px` }, { width: `${value}px` }],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    animation.current.addEventListener("finish", () => { animation.current = null; }, { once: true });
  }, [paintWidth]);

  // The stored width is painted before the browser's first frame; the drag
  // and the snap-back then drive the same DOM variable without React renders.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const stored = preferences.chatPanelWidth > 0 ? preferences.chatPanelWidth : null;
    if (stored === null) dock.style.removeProperty("--kana-chat-width");
    else dock.style.setProperty("--kana-chat-width", `${stored}px`);
  }, [preferences.chatPanelWidth, preferences.avatarVisible]);

  const commitWidth = useCallback(
    (value: number) => {
      const sequence = ++saveSequence.current;
      widthRef.current = value;
      setDraggedWidth(value);
      void workspace.actions
        .savePreferences({
          ...workspace.stores.preferences.getState().preferences,
          chatPanelWidth: Math.round(value),
        })
        .then(() => {
          // The store now holds the same width; stop overriding it. A new
          // drag started meanwhile keeps its own value.
          if (saveSequence.current === sequence) setDraggedWidth(null);
        })
        .catch(() => undefined);
    },
    [workspace],
  );

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dock = dockRef.current;
    if (!resizable || event.button !== 0 || !dock) return;
    clearHold();
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    animation.current?.cancel();
    animation.current = null;
    const startWidth = dock.getBoundingClientRect().width;
    drag.current = { startX: event.clientX, startWidth };
    widthRef.current = startWidth;
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [clearHold, resizable]);

  const moveResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const { min, max } = resizeBounds();
    const raw = state.startWidth + (state.startX - event.clientX);
    // Past the settled maximum the panel keeps following the pointer, up to
    // 90% of the screen; releasing springs it back to 70%. Below the minimum
    // it stops.
    const dragMax = window.innerWidth * CHAT_DRAG_MAX_SHARE;
    const next = raw > max ? Math.min(raw, dragMax) : Math.max(min, raw);
    widthRef.current = next;
    // Holding the frame at the hard stop becomes a way into focus mode.
    if (raw >= dragMax - 0.5) {
      if (holdTimer.current === null) {
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          enterAutoFocus();
        }, CHAT_AUTO_FOCUS_HOLD_MS);
      }
    } else {
      clearHold();
    }
    // Paint the drag from the DOM: one rAF per frame, no React render.
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (widthRef.current !== null) paintWidth(widthRef.current);
      });
    }
  }, [clearHold, enterAutoFocus, paintWidth]);

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    clearHold();
    if (!drag.current) return;
    drag.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (widthRef.current !== null) {
      const { min, max } = resizeBounds();
      const settled = Math.min(max, Math.max(min, widthRef.current));
      settleWidth(settled);
      commitWidth(settled);
    }
  }, [clearHold, commitWidth, settleWidth]);

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const { min, max } = resizeBounds();
      const current = dockRef.current?.getBoundingClientRect().width ?? widthRef.current ?? min;
      const step = event.shiftKey ? 48 : 16;
      const next =
        event.key === "ArrowLeft"
          ? current + step
          : event.key === "ArrowRight"
            ? current - step
            : event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : null;
      if (next === null) return;
      event.preventDefault();
      const clamped = Math.min(max, Math.max(min, next));
      settleWidth(clamped);
      commitWidth(clamped);
    },
    [commitWidth, settleWidth],
  );

  // The avatar centres itself between the screen's left edge and the panel's
  // left edge, so it needs the panel's measured width, not its own guess.
  useEffect(() => {
    const dock = dockRef.current;
    const host = dock?.parentElement;
    if (!dock || !host) return;
    const update = () => {
      const measured = dock.getBoundingClientRect().width;
      const nextWide = measured >= CHAT_WIDE_WIDTH;
      host.style.setProperty("--kana-chat-panel-width", `${measured}px`);
      setWide((current) => (current === nextWide ? current : nextWide));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--kana-chat-panel-width");
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      animation.current?.cancel();
      animation.current = null;
      clearHold();
    };
  }, [clearHold]);

  // In focus mode the transcript is a centred reading measure inside a wide
  // panel. A wheel outside that measure (the side gutters, the composer) must
  // still move the transcript, not fall through to the page.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented || event.deltaY === 0) return;
      const feed = panel.querySelector<HTMLElement>(".kana-chat-scroll");
      if (!feed || feed.scrollHeight <= feed.clientHeight) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target && feed.contains(target)) return;
      // A dropdown, attachment list, or long draft keeps its own wheel.
      for (let node = target instanceof Element ? target : target?.parentElement ?? null; node && node !== panel; node = node.parentElement) {
        if (node === feed) return;
        if (!(node instanceof HTMLElement)) continue;
        const overflowY = window.getComputedStyle(node).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return;
      }
      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? feed.clientHeight
            : 1;
      event.preventDefault();
      feed.scrollBy({ top: event.deltaY * scale, behavior: "auto" });
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <>
      {showRail ? <FocusRail /> : null}
      <div
        ref={dockRef}
        data-wide={wide ? "true" : "false"}
        className={`kana-chat-dock absolute bottom-4 right-4 top-[var(--kana-header-clear)] z-10 w-[min(34vw,480px)] min-w-[390px] transition-transform duration-300 ease-out max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[var(--kana-compact-band)] max-lg:w-full max-lg:min-w-0 ${chatVisible ? "" : "is-closed"} ${avatarVisible ? "" : "is-sole"} ${greeting ? "is-away" : ""} ${resizing ? "is-resizing" : ""}`}
      >
      {resizable ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="kana-chat-panel"
          aria-label={text.resizeChat}
          aria-valuemin={CHAT_MIN_WIDTH}
          aria-valuemax={Math.round((typeof window === "undefined" ? 1920 : window.innerWidth) * CHAT_MAX_SHARE)}
          aria-valuenow={Math.round(width ?? CHAT_MIN_WIDTH)}
          tabIndex={0}
          className="kana-chat-resize kana-focus max-lg:hidden"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={resizeWithKeyboard}
        />
      ) : null}
      <button
        type="button"
        className="kana-chat-toggle absolute -left-12 top-1/2 z-20 h-28 w-12 -translate-y-1/2 text-accent hover:text-accent-hover max-lg:hidden"
        aria-controls="kana-chat-panel"
        aria-expanded={chatVisible}
        aria-label={chatVisible ? text.hideChat : text.showChat}
        onClick={() => workspace.stores.workspace.setState((state) => ({ chatOpen: !state.chatOpen }))}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 48 112"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M48 0H27C22 0 19 2 16 6L5 20C2 24 1 28 1 33V79C1 84 2 88 5 92L16 106C19 110 22 112 27 112H48Z"
            fill="currentColor"
          />
        </svg>
        <span className="relative z-10 grid h-full place-items-center text-on-accent">
          {chatVisible ? <ChevronRightIcon className="size-5" /> : <ChevronLeftIcon className="size-5" />}
        </span>
      </button>

      <section
        ref={panelRef}
        id="kana-chat-panel"
        inert={chatVisible ? undefined : true}
        aria-hidden={!chatVisible}
        className="kana-chat-panel flex h-full w-full flex-col overflow-hidden rounded-none"
      >
        <div className="flex min-h-0 flex-1">
          <ChatFeed />
        </div>
        <ChatComposer />
      </section>
      </div>
    </>
  );
}
