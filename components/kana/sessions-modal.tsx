"use client";

import { getCopy } from "@/lib/ui/copy";
import { ConversationSidebar } from "./conversation-sidebar";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";

export function SessionsModal() {
  const workspace = useKanaWorkspace();
  const { actions } = workspace;
  const open = useKanaStore("workspace", (state) => state.sessionsOpen);
  const conversations = useKanaStore("conversations", (state) => state.conversations);
  const activeId = useKanaStore("conversations", (state) => state.activeConversationId ?? undefined);
  const hermesSessions = useKanaStore("conversations", (state) => state.hermesSessions);
  const busy = useKanaStore("agentSession", (state) => state.busy);
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  if (!open) return null;

  const close = () => workspace.stores.workspace.setState({ sessionsOpen: false });
  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-[var(--backdrop)] p-3 backdrop-blur-sm max-sm:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={getCopy(locale).workspace.conversationHistory}
      onClick={close}
    >
      <section
        className="kana-settings-shell flex h-full w-[min(380px,100%)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-raised animate-kana-in max-sm:w-full max-sm:rounded-none max-sm:border-0"
        onClick={(event) => event.stopPropagation()}
      >
        <ConversationSidebar
          conversations={conversations}
          activeId={activeId}
          disabled={busy}
          hermesSessions={hermesSessions}
          onAdopt={(session) => void actions.adoptHermesSession(session)}
          onCreate={() => {
            void actions.createConversation();
            close();
          }}
          onSelect={(id) => {
            actions.selectConversation(id);
            close();
          }}
          onRename={actions.renameConversation}
          onDelete={actions.deleteConversation}
          onClose={close}
          locale={locale}
        />
      </section>
    </div>
  );
}
