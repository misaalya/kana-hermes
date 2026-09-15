"use client";

import { live2DModelLayout } from "@/lib/avatar/model-bindings";
import { DEFAULT_LIVE2D_MODEL_LAYOUT } from "@/lib/avatar/model-layout";
import { useTheme } from "@/lib/state/use-theme";
import { selectActiveConversation } from "@/lib/store/conversation-store";
import { getCopy } from "@/lib/ui/copy";
import { AvatarLayoutControl } from "./avatar-layout-control";
import { HistoryIcon, MoonIcon, SettingsIcon, SunIcon } from "./icons";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { useUpdateAvatarLayout } from "./workspace-stage";

export function WorkspaceHeader() {
  const workspace = useKanaWorkspace();
  const { theme, toggleTheme } = useTheme();
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const live2d = useKanaStore("preferences", (state) => state.preferences.live2d);
  const title = useKanaStore("conversations", (state) => selectActiveConversation(state)?.title);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const updateAvatarLayout = useUpdateAvatarLayout();
  const copy = getCopy(locale);
  const text = copy.workspace;
  const setWorkspace = workspace.stores.workspace.setState;

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 p-4 max-sm:p-3">
      {/* Phones and tablets use that corner for the avatar tile. */}
      <div className="pointer-events-auto min-w-0 max-lg:hidden">
        <p className="kana-session-title max-w-[34vw] truncate px-3 py-2 text-xs font-bold text-ink">
          {title ?? text.newMoment}
        </p>
      </div>

      <nav className="pointer-events-auto ml-auto flex items-center gap-2" aria-label={text.actions}>
        <button
          type="button"
          className="kana-workspace-action kana-focus"
          onClick={toggleTheme}
          aria-label={text.switchTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span className="max-sm:sr-only">{theme === "dark" ? text.light : text.dark}</span>
        </button>
        <AvatarLayoutControl
          layout={live2DModelLayout(live2d)}
          copy={copy}
          open={avatarLayoutOpen}
          onOpenChange={(open) => setWorkspace({ avatarLayoutOpen: open })}
          onChange={updateAvatarLayout}
          onReset={() => updateAvatarLayout({ ...DEFAULT_LIVE2D_MODEL_LAYOUT })}
        />
        <button
          type="button"
          className="kana-workspace-action kana-focus"
          onClick={() => setWorkspace({ avatarLayoutOpen: false, sessionsOpen: true })}
          aria-label={text.openHistory}
        >
          <HistoryIcon />
          <span className="max-sm:sr-only">{text.history}</span>
        </button>
        <button
          type="button"
          className="kana-workspace-action kana-focus"
          onClick={() => setWorkspace({ avatarLayoutOpen: false, settingsOpen: true })}
          aria-label={text.openSettings}
        >
          <SettingsIcon />
          <span className="max-sm:sr-only">{text.settings}</span>
        </button>
      </nav>
    </header>
  );
}
