"use client";

import { useEffect, useState } from "react";
import { live2DModelLayout, withLive2DModelLayout } from "@/lib/avatar/model-bindings";
import type { Live2DModelLayout } from "@/lib/avatar/model-layout";
import { getCopy } from "@/lib/ui/copy";
import { AvatarLayoutSurface } from "./avatar-layout-surface";
import { AvatarStage } from "./avatar-stage";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";

/** Save a new avatar position for the loaded model. */
export function useUpdateAvatarLayout() {
  const workspace = useKanaWorkspace();
  return (layout: Live2DModelLayout) => {
    const preferences = workspace.preferences.current();
    void workspace.actions.savePreferences({
      ...preferences,
      live2d: withLive2DModelLayout(preferences.live2d, layout),
    });
  };
}

/** Phones are chat-first; while the avatar is being positioned the stage fills the screen. */
export function useChatVisible(): boolean {
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const chatOpen = useKanaStore("workspace", (state) => state.chatOpen);
  return usesMobileChat ? !avatarLayoutOpen : chatOpen;
}

export function WorkspaceStage() {
  const workspace = useKanaWorkspace();
  const avatar = useKanaStore("avatar", (state) => state.snapshot);
  const background = useKanaStore("preferences", (state) => state.preferences.stageBackground);
  const customBackgroundId = useKanaStore("preferences", (state) => state.preferences.customBackgroundId);
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const live2d = useKanaStore("preferences", (state) => state.preferences.live2d);
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const chatVisible = useChatVisible();
  const updateAvatarLayout = useUpdateAvatarLayout();
  const [customBackground, setCustomBackground] = useState<{ id: string; url: string }>();

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => workspace.stores.workspace.setState({ usesMobileChat: media.matches });
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [workspace]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    if (background !== "custom" || !customBackgroundId) return () => { active = false; };
    void workspace.stageBackgrounds
      .load(customBackgroundId)
      .then((asset) => {
        if (!active || !asset) return;
        objectUrl = URL.createObjectURL(asset.content);
        setCustomBackground({ id: asset.id, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [background, customBackgroundId, workspace]);

  return (
    <>
      <AvatarStage
        avatar={avatar}
        background={background}
        customBackgroundUrl={
          customBackground && customBackground.id === customBackgroundId ? customBackground.url : undefined
        }
        chatOpen={chatVisible}
        compact={usesMobileChat && !avatarLayoutOpen}
        locale={locale}
        onCanvasReady={workspace.actions.attachAvatarCanvas}
      />
      {avatarLayoutOpen && avatar.renderMode === "live2d" ? (
        <AvatarLayoutSurface
          layout={live2DModelLayout(live2d)}
          label={getCopy(locale).settings.avatarLayoutSurface}
          chatOpen={chatVisible}
          onChange={updateAvatarLayout}
        />
      ) : null}
    </>
  );
}
