"use client";

import type { KanaMessage } from "@/lib/conversation/types";
import { selectActiveConversation } from "@/lib/store/conversation-store";
import { isVoiceActive } from "@/lib/store/voice-store";
import { getCopy } from "@/lib/ui/copy";
import { ChatComposer } from "./chat-composer";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { LiveChatFeed } from "./live-chat-feed";
import { useChatVisible } from "./workspace-stage";

const NO_MESSAGES: KanaMessage[] = [];

function ChatFeed() {
  const messages = useKanaStore("conversations", (state) => selectActiveConversation(state)?.messages ?? NO_MESSAGES);
  const activities = useKanaStore("activity", (state) => state.activities);
  const serverActivityTurns = useKanaStore("activity", (state) => state.serverActivityTurns);
  const busy = useKanaStore("agentSession", (state) => state.busy);
  const status = useKanaStore("agentSession", (state) => state.status);
  const voiceActive = useKanaStore("voice", (state) => isVoiceActive(state.runtimeState));
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  return (
    <LiveChatFeed
      messages={messages}
      activities={activities}
      serverActivityTurns={serverActivityTurns}
      busy={busy || voiceActive}
      status={status}
      locale={locale}
    />
  );
}

export function ChatDock() {
  const workspace = useKanaWorkspace();
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const chatVisible = useChatVisible();
  const text = getCopy(locale).workspace;

  return (
    <div className={`kana-chat-dock absolute bottom-4 right-4 top-[76px] z-10 w-[min(34vw,480px)] min-w-[390px] transition-transform duration-300 ease-out max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[var(--kana-compact-band)] max-lg:w-full max-lg:min-w-0 ${chatVisible ? "" : "is-closed"}`}>
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
        id="kana-chat-panel"
        inert={chatVisible ? undefined : true}
        aria-hidden={!chatVisible}
        className="kana-chat-panel flex h-full w-full flex-col overflow-hidden rounded-[22px] max-lg:rounded-none"
      >
        <div className="flex min-h-0 flex-1">
          <ChatFeed />
        </div>
        <ChatComposer />
      </section>
    </div>
  );
}
