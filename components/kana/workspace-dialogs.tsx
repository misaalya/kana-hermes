"use client";

import { useCallback } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import { getCopy } from "@/lib/ui/copy";
import { AgentInputDialog } from "./agent-input-dialog";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { OnboardingWizard } from "./onboarding-dialog";
import { SettingsDialog } from "./settings-dialog";

function SettingsHost() {
  const workspace = useKanaWorkspace();
  const { actions } = workspace;
  const open = useKanaStore("workspace", (state) => state.settingsOpen);
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const modelCatalog = useKanaStore("models", (state) => state.entry?.catalog ?? null);
  const avatarPortraits = useKanaStore("avatar", (state) => state.portraits);
  if (!open) return null;
  return (
    <SettingsDialog
      preferences={preferences}
      onSave={actions.savePreferences}
      onImportAvatar={actions.importAvatarFiles}
      onListAvatarModels={actions.listAvatarModels}
      onInspectAvatarModel={actions.inspectAvatarModel}
      onSelectAvatarModel={actions.selectAvatarModel}
      onRenameAvatarModel={actions.renameAvatarModel}
      onDeleteAvatarModel={actions.deleteAvatarModel}
      onImportStageBackground={actions.importStageBackground}
      onListStageBackgrounds={actions.listStageBackgrounds}
      onLoadStageBackground={actions.loadStageBackground}
      onDeleteStageBackground={actions.deleteStageBackground}
      onInspectHermesControl={actions.inspectHermesControl}
      onStartHermesControl={actions.startHermesControl}
      onStopHermesControl={actions.stopHermesControl}
      agentModelCatalog={modelCatalog}
      onListAgentModels={actions.listAgentModels}
      onSelectAgentModel={actions.selectAgentModel}
      onPreviewAvatarEmotion={actions.previewAvatarEmotion}
      onPreviewAvatarTalking={actions.previewAvatarTalking}
      avatarPortraits={avatarPortraits}
      onClose={() => {
        workspace.stores.workspace.setState({ settingsOpen: false });
        void actions.inspectDependencies();
      }}
    />
  );
}

function InputRequestHost() {
  const { actions } = useKanaWorkspace();
  const request = useKanaStore("agentSession", (state) => state.pendingInput);
  const submitting = useKanaStore("agentSession", (state) => state.respondingToInput);
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  if (!request) return null;
  return (
    <AgentInputDialog
      key={request.kind === "approval" ? `approval-${request.command}` : `${request.kind}-${request.requestId}`}
      request={request}
      submitting={submitting}
      onRespond={actions.respondToInput}
      locale={locale}
    />
  );
}

function SetupHost() {
  const workspace = useKanaWorkspace();
  const setWorkspace = workspace.stores.workspace.setState;
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  const deps = useKanaStore("workspace", (state) => state.deps);
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const degraded = deps.hermes === "missing" || (deps.voice === "error" && preferences.voiceEnabled);
  const setGreeting = useCallback(
    (greeting: boolean) => workspace.stores.workspace.setState({ greeting }),
    [workspace],
  );
  // Kana smiles and starts talking as her greeting begins.
  const greet = useCallback(() => {
    const current = workspace.preferences.current();
    void workspace.actions
      .previewAvatarEmotion(current, "happy")
      .then(() => workspace.actions.previewAvatarTalking(current))
      .catch(() => undefined);
  }, [workspace]);

  if (wizardMode) {
    return (
      <OnboardingWizard
        locale={preferences.uiLocale}
        preferences={preferences}
        deps={deps}
        mode={wizardMode}
        onComplete={workspace.actions.completeOnboarding}
        onDismiss={() => setWizardMode(null)}
        onGreetingChange={setGreeting}
        onGreet={greet}
        onOpenSettings={() => setWorkspace({ wizardMode: null, settingsOpen: true })}
      />
    );
  }
  return degraded ? (
    <DegradedBanner locale={preferences.uiLocale} onCheck={() => setWizardMode("repair")} />
  ) : null;

  function setWizardMode(mode: "repair" | null) {
    setWorkspace({ wizardMode: mode });
  }
}

function DegradedBanner({ locale, onCheck }: { locale: KanaPreferences["uiLocale"]; onCheck(): void }) {
  const copy = getCopy(locale);
  return (
    <div className="kana-panel kana-degraded-banner absolute bottom-5 left-5 z-20 flex max-w-[380px] items-center gap-3 rounded-full py-2 pl-4 pr-2">
      <p className="text-[11px] font-bold text-ink-dim">{copy.banner.degraded}</p>
      <button
        type="button"
        className="kana-focus kana-pill kana-pill-accent shrink-0 px-3.5 py-1.5 text-[11px]"
        onClick={onCheck}
      >
        {copy.banner.action}
      </button>
    </div>
  );
}

/** Settings, Hermes input requests, first-run setup, and the degraded-service banner. */
export function WorkspaceDialogs() {
  return (
    <>
      <SettingsHost />
      <InputRequestHost />
      <SetupHost />
    </>
  );
}
