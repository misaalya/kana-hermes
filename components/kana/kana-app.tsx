"use client";

import { useEffect } from "react";
import { getCopy } from "@/lib/ui/copy";
import { ChatDock } from "./chat-dock";
import { ConnectionScreen, useConnectionScreen } from "./connection-screen";
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
  const connection = useConnectionScreen();
  const connectionDown = connection.connectionDown;

  // One automatic connection attempt per page load, then the setup checks.
  useEffect(() => {
    if (!ready) return;
    void workspace.setup.startAfterReady();
    return () => workspace.setup.stop();
  }, [ready, workspace]);

  // Phones are chat-first; the chat layout needs this before its first frame,
  // including the frame after the connection screen steps away.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => workspace.stores.workspace.setState({ usesMobileChat: media.matches });
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [workspace]);

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
      {connectionDown ? null : <WorkspaceStage />}
      <WorkspaceHeader connectionDown={connectionDown} />
      {connectionDown ? null : <ChatDock />}
      <SessionsModal />
      <ConnectionScreen screen={connection} />
      <WorkspaceDialogs />
    </main>
  );
}
