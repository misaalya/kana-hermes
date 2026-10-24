"use client";

import { getCopy } from "@/lib/ui/copy";
import { ConversationSidebar } from "./conversation-sidebar";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";

/**
 * The persistent conversation rail for the desktop focus layout. The avatar
 * stage stays behind the workspace; this rail and the chat column are the two
 * surfaces a reader works in.
 */
export function FocusRail() {
  const workspace = useKanaWorkspace();
  const { actions } = workspace;
  const conversations = useKanaStore("conversations", (state) => state.conversations);
  const activeId = useKanaStore("conversations", (state) => state.activeConversationId ?? undefined);
  const hermesSessions = useKanaStore("conversations", (state) => state.hermesSessions);
  const busy = useKanaStore("agentSession", (state) => state.busy);
  const sessionsOpen = useKanaStore("workspace", (state) => state.sessionsOpen);
  const greeting = useKanaStore("workspace", (state) => state.greeting);
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const copy = getCopy(locale);

  return (
    <div
      className={`kana-focus-rail max-lg:hidden ${greeting ? "is-away" : ""}`}
      inert={sessionsOpen || greeting || undefined}
    >
      <ConversationSidebar
        className="min-h-0 flex-1"
        headingLevel={2}
        ariaLabel={copy.history.title}
        conversations={conversations}
        activeId={activeId}
        disabled={busy}
        hermesSessions={hermesSessions}
        onAdopt={(session) => void actions.adoptHermesSession(session)}
        onCreate={() => {
          void actions.createConversation();
          document.getElementById("kana-message")?.focus();
        }}
        onSelect={actions.selectConversation}
        onRename={actions.renameConversation}
        onDelete={actions.deleteConversation}
        locale={locale}
        footer={
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-soft min-h-10 w-full text-[12.5px]"
            onClick={() =>
              void actions.savePreferences({
                ...preferences,
                avatarVisible: true,
              })
            }
          >
            {copy.settings.avatarVisible}
          </button>
        }
      />
    </div>
  );
}
