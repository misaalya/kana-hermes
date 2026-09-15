"use client";

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

  if (wizardMode) {
    return (
      <OnboardingWizard
        locale={preferences.uiLocale}
        preferences={preferences}
        deps={deps}
        mode={wizardMode}
        onComplete={workspace.actions.completeOnboarding}
        onDismiss={() => setWizardMode(null)}
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
    <div className="kana-panel kana-degraded-banner absolute bottom-5 left-5 z-20 flex max-w-[360px] items-center gap-3 rounded-md px-3.5 py-2.5">
      <p className="text-[10px] font-semibold text-ink-dim">{copy.banner.degraded}</p>
      <button
        type="button"
        className="kana-focus rounded-lg px-2 py-1 text-[10px] font-bold text-accent-strong hover:bg-accent/10"
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
