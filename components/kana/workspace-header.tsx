"use client";

import { live2DModelLayout } from "@/lib/avatar/model-bindings";
import { DEFAULT_LIVE2D_MODEL_LAYOUT } from "@/lib/avatar/model-layout";
import { useTheme } from "@/lib/state/use-theme";
import { selectActiveConversation } from "@/lib/store/conversation-store";
import { getCopy } from "@/lib/ui/copy";
import { AvatarLayoutControl } from "./avatar-layout-control";
import { HeaderHostMonitor } from "./header-host-monitor";
import { HistoryIcon, MoonIcon, SettingsIcon, SunIcon } from "./icons";
import { HeaderFocusHost } from "./mobile-host-panel";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { useUpdateAvatarLayout } from "./workspace-stage";

export function WorkspaceHeader({ connectionDown = false }: { connectionDown?: boolean }) {
  const workspace = useKanaWorkspace();
  const { theme, toggleTheme } = useTheme();
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const locale = preferences.uiLocale;
  const live2d = preferences.live2d;
  const title = useKanaStore("conversations", (state) => selectActiveConversation(state)?.title);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const avatarVisible = useKanaStore("preferences", (state) => state.preferences.avatarVisible);
  const greeting = useKanaStore("workspace", (state) => state.greeting);
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  // The desktop focus rail already lists every conversation; a second history
  // button would only duplicate it. Phones have no rail and keep the button,
  // and a disconnected workspace keeps its only entry point.
  const historyInRail = !avatarVisible && !usesMobileChat && !connectionDown;
  const updateAvatarLayout = useUpdateAvatarLayout();
  const copy = getCopy(locale);
  const text = copy.workspace;
  const setWorkspace = workspace.stores.workspace.setState;
  const { actions } = workspace;

  return (
    <header
      className={`kana-workspace-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 p-4 max-sm:p-3 ${greeting ? "is-away" : ""}`}
      inert={greeting || undefined}
    >
      {/* Phones and tablets use that corner for the avatar tile. */}
      <div className="pointer-events-auto min-w-0 max-w-[34vw] max-lg:hidden">
        <p className="kana-session-title w-fit max-w-full truncate">
          {title ?? text.newMoment}
        </p>
      </div>

      {!usesMobileChat && !greeting ? (
        <HeaderHostMonitor
          locale={locale}
          layout={preferences.hostWidgetLayout}
          onLayout={(layout) => {
            void actions.savePreferences({ ...preferences, hostWidgetLayout: layout });
          }}
        />
      ) : null}

      {usesMobileChat && !avatarVisible && !connectionDown ? <HeaderFocusHost /> : null}

      <nav className="kana-bar pointer-events-auto ml-auto shrink-0 lg:ml-0" aria-label={text.actions}>
        <button
          type="button"
          className="kana-workspace-action kana-focus"
          onClick={toggleTheme}
          aria-label={text.switchTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span className="kana-tip">{theme === "dark" ? text.light : text.dark}</span>
        </button>
        {/* Positioning an avatar that is not on screen has nothing to show. */}
        {avatarVisible && !connectionDown ? (
          <AvatarLayoutControl
            layout={live2DModelLayout(live2d)}
            copy={copy}
            open={avatarLayoutOpen}
            onOpenChange={(open) => setWorkspace({ avatarLayoutOpen: open })}
            onChange={updateAvatarLayout}
            onReset={() => updateAvatarLayout({ ...DEFAULT_LIVE2D_MODEL_LAYOUT })}
          />
        ) : null}
        {historyInRail ? null : (
          <button
            type="button"
            className="kana-workspace-action kana-focus"
            onClick={() => setWorkspace({ avatarLayoutOpen: false, sessionsOpen: true })}
            aria-label={text.openHistory}
          >
            <HistoryIcon />
            <span className="kana-tip">{text.history}</span>
          </button>
        )}
        <button
          type="button"
          className="kana-workspace-action kana-focus"
          onClick={() => setWorkspace({ avatarLayoutOpen: false, settingsOpen: true })}
          aria-label={text.openSettings}
        >
          <SettingsIcon />
          <span className="kana-tip">{text.settings}</span>
        </button>
      </nav>
    </header>
  );
}
