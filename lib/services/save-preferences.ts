import { live2DModelBindings, live2DModelLayout } from "@/lib/avatar/model-bindings";
import { normalizeKanaPreferences } from "@/lib/preferences/local-preferences-store";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { AgentSessionStore } from "@/lib/store/agent-session-store";
import { statusCopy } from "./agent-event-handlers";
import type { PreferencesAccess } from "./preferences-service";

export type SavePreferencesDependencies = {
  preferences: PreferencesAccess;
  agentSession: AgentSessionStore;
  voice: { flushHeld(): void };
  avatar: {
    configure(next: KanaPreferences, files?: File[], force?: boolean): Promise<boolean>;
    controller: { setLayout(layout: ReturnType<typeof live2DModelLayout>): void };
  };
};

/** Save preferences and apply what changed to speech and the avatar. */
export async function savePreferences(deps: SavePreferencesDependencies, input: KanaPreferences): Promise<void> {
  const next = normalizeKanaPreferences(input);
  const previous = deps.preferences.current();
  deps.preferences.persist(next);
  if (previous.uiLocale !== next.uiLocale && !deps.agentSession.getState().busy) {
    deps.agentSession.setState({ status: statusCopy(next.uiLocale).ready });
  }

  if (previous.voiceEnabled && !next.voiceEnabled) {
    // Turning voice off is an immediate text-only transition: stop playback
    // and reveal a reply that was waiting for audio.
    deps.voice.flushHeld();
    deps.agentSession.setState({ status: statusCopy(next.uiLocale).ready });
  }

  const avatarRuntimeChanged =
    previous.avatarMode !== next.avatarMode ||
    previous.live2d.coreScriptUrl !== next.live2d.coreScriptUrl ||
    previous.live2d.modelId !== next.live2d.modelId ||
    previous.live2d.modelUrl !== next.live2d.modelUrl ||
    JSON.stringify(live2DModelBindings(previous.live2d)) !== JSON.stringify(live2DModelBindings(next.live2d));
  const avatarLayoutChanged =
    JSON.stringify(live2DModelLayout(previous.live2d)) !== JSON.stringify(live2DModelLayout(next.live2d));
  if (avatarRuntimeChanged) {
    await deps.avatar.configure(next, undefined, true);
  } else if (avatarLayoutChanged) {
    // Sliders move the loaded model directly; reloading assets on every
    // pointer movement flashes and churns the GPU.
    deps.avatar.controller.setLayout(live2DModelLayout(next.live2d));
  }
}
