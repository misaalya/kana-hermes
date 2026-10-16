"use client";

import { useCallback } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import { getCopy } from "@/lib/ui/copy";
import { AgentInputDialog } from "./agent-input-dialog";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { OnboardingWizard } from "./onboarding-dialog";
import { SettingsDialog } from "./settings-dialog";
import { UpdateNotice } from "./update-notice";

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
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  const deps = useKanaStore("workspace", (state) => state.deps);
  const preferences = useKanaStore("preferences", (state) => state.preferences);
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

  if (!wizardMode) return null;
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
      onOpenSettings={() => workspace.stores.workspace.setState({ wizardMode: null, settingsOpen: true })}
    />
  );

  function setWizardMode(mode: "repair" | null) {
    workspace.stores.workspace.setState({ wizardMode: mode });
  }
}

function DegradedBanner({ locale, onCheck }: { locale: KanaPreferences["uiLocale"]; onCheck(): void }) {
  const copy = getCopy(locale);
  return (
    <div className="kana-panel kana-notice flex max-w-[380px] shrink-0 items-center gap-3 p-3">
      <p className="text-[12px] font-extrabold text-ink">{copy.banner.degraded}</p>
      <button
        type="button"
        className="kana-focus kana-pill kana-pill-accent min-h-9 shrink-0 px-3.5 text-[11px]"
        onClick={onCheck}
      >
        {copy.banner.action}
      </button>
    </div>
  );
}

/**
 * The workspace corner notices. Both boxes share ONE positioned wrapper, so the
 * degraded-service banner and the update notice stack instead of painting over
 * each other (and neither can be Tab-reachable while hidden behind the other).
 * The wrapper is not itself a `.kana-notice`: that class belongs to each box.
 *
 * The wrapper carries no z-index. A z-index here would make it a stacking
 * context, and the update dialog this subtree renders (a `fixed` backdrop) would
 * then be trapped inside the wrapper's layer: its own z-50 would be measured
 * against the workspace's other modals rather than above them, so the
 * connection gate or Settings would paint over it. Its `.kana-notice` boxes
 * carry the layer instead (see globals.css).
 */
function NoticesHost() {
  const workspace = useKanaWorkspace();
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  const deps = useKanaStore("workspace", (state) => state.deps);
  const preferences = useKanaStore("preferences", (state) => state.preferences);
  const degraded = deps.hermes === "missing" || (deps.voice === "error" && preferences.voiceEnabled);
  // The setup wizard is a full screen of its own; the corner stays clear.
  if (wizardMode) return null;
  return (
    <div className="kana-notices absolute bottom-5 left-5 flex flex-col items-start gap-2">
      {degraded ? (
        <DegradedBanner
          locale={preferences.uiLocale}
          onCheck={() => workspace.stores.workspace.setState({ wizardMode: "repair" })}
        />
      ) : null}
      <UpdateNotice locale={preferences.uiLocale} />
    </div>
  );
}

/** Settings, Hermes input requests, first-run setup, and the workspace notices. */
export function WorkspaceDialogs() {
  return (
    <>
      <SettingsHost />
      <InputRequestHost />
      <SetupHost />
      <NoticesHost />
    </>
  );
}
