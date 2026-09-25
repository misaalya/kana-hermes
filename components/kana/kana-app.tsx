"use client";

import { useEffect } from "react";
import { getCopy } from "@/lib/ui/copy";
import { ChatDock } from "./chat-dock";
import { ConnectionGate } from "./connection-gate";
import { KanaWorkspaceProvider, useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { SessionsModal } from "./sessions-modal";
import { WorkspaceDialogs } from "./workspace-dialogs";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceStage } from "./workspace-stage";

export function KanaApp() {
  return (
    <KanaWorkspaceProvider>
      <Workspace />
    </KanaWorkspaceProvider>
  );
}

function Workspace() {
  const workspace = useKanaWorkspace();
  const ready = useKanaStore("conversations", (state) => state.ready);
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);

  // One automatic connection attempt per page load, then the setup checks.
  useEffect(() => {
    if (!ready) return;
    void workspace.setup.startAfterReady();
    return () => workspace.setup.stop();
  }, [ready, workspace]);

  // The loading screen shows before the saved theme is applied, so it is
  // always light: a plain page with plain text, no pattern or bubble.
  if (!ready) {
    return (
      <main data-theme="light" className="grid min-h-dvh place-items-center bg-bg">
        <p className="animate-kana-pulse text-sm font-bold text-ink-dim">
          {getCopy(locale).workspace.preparing}
        </p>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <WorkspaceStage />
      <WorkspaceHeader />
      <ChatDock />
      <SessionsModal />
      <ConnectionGate />
      <WorkspaceDialogs />
    </main>
  );
}
