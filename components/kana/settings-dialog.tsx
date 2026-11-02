"use client";

import { useEffect, useRef, useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { AvatarPortraits } from "@/lib/avatar/portrait";
import type { Live2DModelBindings } from "@/lib/avatar/live2d-avatar-provider";
import type { AddHermesModelInput, HermesCustomProvider } from "@/lib/runtime/hermes-models-client";
import type { AddHermesModelResult } from "@/lib/services/model-change-restart";
import {
  suggestLive2DModelBindings,
  type Live2DModelCapabilities,
} from "@/lib/avatar/live2d-model-capabilities";
import {
  live2DModelBindings,
  live2DSourceKey,
} from "@/lib/avatar/model-bindings";
import type {
  StageBackgroundAsset,
  StageBackgroundSummary,
} from "@/lib/background/indexed-db-stage-background-store";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { readUpdateStatus } from "@/lib/runtime/update-client";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import type { Emotion } from "@/lib/presentation/types";
import { OFFICIAL_LIVE2D_SAMPLES } from "@/lib/avatar/defaults";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { getCopy } from "@/lib/ui/copy";
import { useShiftIntoViewport } from "@/lib/ui/use-shift-into-viewport";
import { HermesControlPanel } from "./hermes-control-panel";
import { VoiceEnginePanel } from "./voice-engine-panel";
import { VoicePanel } from "./voice-panel";
import { AvatarExpressionPanel } from "./avatar-expression-panel";
import { wipeAvatarModeChange } from "./avatar-mode-transition";
import { ComposerDelaySlider } from "./composer-delay-slider";
import { HostPanel } from "./host-panel";
import { ModelControlPanel } from "./model-control-panel";
import { CustomModelManager } from "./custom-model-manager";
import { AdvancedConfigCard, SecuritySection } from "./settings-access-section";
import { AddCard, AvatarCard, WardrobeGrid } from "./settings-avatar-cards";
import {
  STAGE_BACKGROUND_OPTIONS,
  StageBackgroundChoice,
  StoredStageBackgroundChoice,
} from "./settings-stage-background";
import {
  AvatarIcon,
  BotIcon,
  ChevronRightIcon,
  CloseIcon,
  GlobeIcon,
  PlugIcon,
  ServerIcon,
  ShieldIcon,
  WaveformIcon,
} from "./icons";
import { Toggle } from "./ui";
import {
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  SettingsSegmented,
} from "./settings-layout";

type SettingsDialogProps = {
  preferences: KanaPreferences;
  /** The connected Hermes runtime; Kana's model default belongs to it. */
  runtimeId?: string | null;
  onSave(preferences: KanaPreferences): Promise<void>;
  onImportAvatar(files: File[]): Promise<AvatarModelSummary>;
  onListAvatarModels(): Promise<AvatarModelSummary[]>;
  onInspectAvatarModel(id: string): Promise<Live2DModelCapabilities>;
  onSelectAvatarModel(id: string): Promise<AvatarModelSummary>;
  onRenameAvatarModel(id: string, name: string): Promise<AvatarModelSummary>;
  onDeleteAvatarModel(id: string): Promise<void>;
  onImportStageBackground(file: File): Promise<StageBackgroundSummary>;
  onListStageBackgrounds(): Promise<StageBackgroundSummary[]>;
  onLoadStageBackground(id: string): Promise<StageBackgroundAsset | null>;
  onDeleteStageBackground(id: string): Promise<void>;
  onInspectHermesControl(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: { port?: number; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  /** Cached Hermes model catalog, updated by background refreshes. */
  agentModelCatalog?: AgentModelCatalog | null;
  onListAgentModels(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelectAgentModel(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
  onListHermesModelProviders(): Promise<HermesCustomProvider[]>;
  onAddHermesModel(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onPreviewAvatarEmotion(preferences: KanaPreferences, emotion: Emotion): Promise<void>;
  onPreviewAvatarTalking(preferences: KanaPreferences): Promise<void>;
  /** Stage portraits for the avatar cards, by imported model id or model URL. */
  avatarPortraits?: AvatarPortraits;
  /** The host is keeping this mounted for its exit animation. */
  closing?: boolean;
  onClose(): void;
};

type SettingsSection = "experience" | "voice" | "avatar" | "model" | "providers" | "system" | "privacy";

const NAV_IDS: SettingsSection[] = ["experience", "voice", "avatar", "model", "providers", "system", "privacy"];

const SECTION_ICONS: Record<SettingsSection, (props: { className?: string }) => React.ReactElement> = {
  experience: GlobeIcon,
  voice: WaveformIcon,
  avatar: AvatarIcon,
  model: BotIcon,
  providers: PlugIcon,
  system: ServerIcon,
  privacy: ShieldIcon,
};

type SettingsNavItem = {
  id: SettingsSection;
  label: string;
};

export function SettingsDialog({
  preferences,
  runtimeId = null,
  onSave,
  onClose,
  onImportAvatar,
  onListAvatarModels,
  onInspectAvatarModel,
  onSelectAvatarModel,
  onRenameAvatarModel,
  onDeleteAvatarModel,
  onImportStageBackground,
  onListStageBackgrounds,
  onLoadStageBackground,
  onDeleteStageBackground,
  onInspectHermesControl,
  onStartHermesControl,
  onStopHermesControl,
  agentModelCatalog,
  onListAgentModels,
  onSelectAgentModel,
  onListHermesModelProviders,
  onAddHermesModel,
  onPreviewAvatarEmotion,
  onPreviewAvatarTalking,
  avatarPortraits = {},
  closing = false,
}: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  // A dialog wider than the window is shifted in, never cropped; `left` keeps
  // its fixed-position dropdowns measured from the viewport.
  useShiftIntoViewport(dialogRef, true, { mode: "left", edge: 0 });
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const copy = getCopy(draft.uiLocale);
  const settingsCopy = copy.settings;
  const notices = copy.settingsNotices;
  const navItems: SettingsNavItem[] = NAV_IDS.map((id) => ({
    id,
    ...settingsCopy.sections[id],
  }));
  const [section, setSection] = useState<SettingsSection>("experience");
  const navRef = useRef<HTMLElement | null>(null);

  // Phones scroll the section tabs sideways; center the active one so it is
  // never left half cut at an edge.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const centered = nav.scrollLeft + (activeRect.left - navRect.left) - (nav.clientWidth - activeRect.width) / 2;
    nav.scrollTo({
      left: Math.max(0, Math.min(centered, nav.scrollWidth - nav.clientWidth)),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [section]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [avatarModels, setAvatarModels] = useState<AvatarModelSummary[]>([]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [avatarCapabilityResult, setAvatarCapabilityResult] = useState<{
    modelId: string;
    capabilities: Live2DModelCapabilities | null;
    error: boolean;
  } | null>(null);
  const [stageBackgrounds, setStageBackgrounds] = useState<StageBackgroundSummary[]>([]);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const initialDraftRef = useRef(true);
  const lastDraftRef = useRef(draft);
  const saveRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // The footer names the running version once settings settle. The update
  // endpoint is server-cached, so opening Settings does not re-ask npm.
  useEffect(() => {
    let active = true;
    readUpdateStatus()
      .then((status) => {
        if (active) setAppVersion(status.currentVersion);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialDraftRef.current) {
      initialDraftRef.current = false;
      return;
    }
    const previousDraft = lastDraftRef.current;
    lastDraftRef.current = draft;
    const revision = ++saveRevisionRef.current;
    setSaveState("saving");
    const previousSave = saveQueueRef.current.catch(() => undefined);
    const startSave = () => {
      try {
        return onSaveRef.current(draft);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const queuedSave = previousDraft.voiceEnabled !== draft.voiceEnabled
      ? Promise.all([previousSave, startSave()]).then(() => undefined)
      : previousSave.then(() => {
          // Rapid controls (notably sliders and model bindings) only need the
          // newest queued value. Skipping superseded drafts prevents a slow
          // avatar load from building a long settings backlog.
          if (saveRevisionRef.current !== revision) return;
          return startSave();
        });
    saveQueueRef.current = queuedSave;
    void queuedSave.then(
      () => {
        if (saveRevisionRef.current === revision) setSaveState("saved");
      },
      () => {
        if (saveRevisionRef.current === revision) setSaveState("error");
      },
    );
  }, [draft]);

  // The wardrobe and its model capabilities are only read while the avatar is
  // on: the section hides them, so nothing should load them either.
  useEffect(() => {
    if (section !== "avatar" || !draft.avatarVisible) return;
    let active = true;
    void onListAvatarModels()
      .then((models) => { if (active) setAvatarModels(models); })
      .catch((error) => { if (active) setAvatarNotice(error instanceof Error ? error.message : notices.avatarsLoadFailed); });
    return () => { active = false; };
  }, [draft.avatarVisible, notices.avatarsLoadFailed, onListAvatarModels, section]);

  useEffect(() => {
    if (section !== "avatar" || !draft.avatarVisible || !draft.live2d.modelId) return;
    const modelId = draft.live2d.modelId;
    let active = true;
    void onInspectAvatarModel(modelId).then(
      (capabilities) => {
        if (!active) return;
        setAvatarCapabilityResult({ modelId, capabilities, error: false });
        setDraft((current) => {
          if (current.live2d.modelId !== modelId) return current;
          const sourceKey = live2DSourceKey(current.live2d);
          if (current.live2d.bindingProfiles?.[sourceKey]) return current;
          return {
            ...current,
            live2d: {
              ...current.live2d,
              bindingProfiles: {
                ...current.live2d.bindingProfiles,
                [sourceKey]: suggestLive2DModelBindings(capabilities),
              },
            },
          };
        });
      },
      () => {
        if (!active) return;
        setAvatarCapabilityResult({ modelId, capabilities: null, error: true });
      },
    );
    return () => { active = false; };
  }, [draft.avatarVisible, draft.live2d.modelId, onInspectAvatarModel, section]);

  useEffect(() => {
    if (section !== "avatar") return;
    let active = true;
    void onListStageBackgrounds()
      .then((backgrounds) => {
        if (active) setStageBackgrounds(backgrounds);
      })
      .catch((error) => {
        if (active) {
          setBackgroundNotice(
            error instanceof Error
              ? error.message
              : notices.backgroundsLoadFailed,
          );
        }
      });
    return () => { active = false; };
  }, [notices.backgroundsLoadFailed, onListStageBackgrounds, section]);

  const selectOfficialAvatar = async (index: number) => {
    const sample = OFFICIAL_LIVE2D_SAMPLES[index];
    if (!sample) return;
    const next: KanaPreferences = {
      ...draft,
      live2d: {
        ...draft.live2d,
        modelUrl: sample.modelUrl,
        modelId: undefined,
        modelName: sample.name,
      },
    };
    setDraft(next);
    setAvatarNotice(notices.avatarSelected(sample.name));
  };

  const importStageBackground = async (file: File) => {
    setBackgroundBusy(true);
    setBackgroundNotice(null);
    try {
      const imported = await onImportStageBackground(file);
      setStageBackgrounds((current) => [
        imported,
        ...current.filter((item) => item.id !== imported.id),
      ]);
      setDraft((current) => ({
        ...current,
        stageBackground: "custom",
        customBackgroundId: imported.id,
      }));
      setBackgroundNotice(notices.backgroundApplied(imported.name));
    } catch (error) {
      setBackgroundNotice(
        error instanceof Error ? error.message : notices.backgroundImportFailed,
      );
    } finally {
      setBackgroundBusy(false);
      if (backgroundInputRef.current) backgroundInputRef.current.value = "";
    }
  };

  const deleteStageBackground = async (background: StageBackgroundSummary) => {
    setBackgroundBusy(true);
    setBackgroundNotice(null);
    try {
      await onDeleteStageBackground(background.id);
      setStageBackgrounds((current) => current.filter((item) => item.id !== background.id));
      if (draft.customBackgroundId === background.id) {
        setDraft((current) => ({
          ...current,
          stageBackground: "plain",
          customBackgroundId: undefined,
        }));
      }
      setBackgroundNotice(notices.backgroundRemoved(background.name));
    } catch (error) {
      setBackgroundNotice(
        error instanceof Error ? error.message : notices.backgroundRemoveFailed,
      );
    } finally {
      setBackgroundBusy(false);
    }
  };

  const importAvatar = async (files: File[]) => {
    if (!files.length) return;
    setAvatarBusy(true);
    setAvatarNotice(null);
    try {
      const imported = await onImportAvatar(files);
      const capabilities = imported.capabilities ?? await onInspectAvatarModel(imported.id);
      const sourceKey = `import:${imported.id}`;
      setDraft((current) => ({
        ...current,
        live2d: {
          ...current.live2d,
          modelId: imported.id,
          modelName: imported.name,
          bindingProfiles: {
            ...current.live2d.bindingProfiles,
            [sourceKey]: suggestLive2DModelBindings(capabilities),
          },
        },
      }));
      setAvatarCapabilityResult({
        modelId: imported.id,
        capabilities,
        error: false,
      });
      setAvatarModels(await onListAvatarModels());
      setAvatarNotice(notices.avatarReady(imported.name));
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : notices.avatarImportFailed);
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const selectImported = async (model: AvatarModelSummary) => {
    setAvatarBusy(true);
    try {
      await onSelectAvatarModel(model.id);
      setDraft((current) => ({
        ...current,
        live2d: {
          ...current.live2d,
          modelId: model.id,
          modelName: model.name,
        },
      }));
      setAvatarNotice(notices.avatarSelected(model.name));
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : notices.avatarUseFailed);
    } finally {
      setAvatarBusy(false);
    }
  };

  const renameImported = async (model: AvatarModelSummary) => {
    const name = window.prompt(settingsCopy.avatarNamePrompt, model.name);
    if (!name?.trim()) return;
    const renamed = await onRenameAvatarModel(model.id, name);
    setAvatarModels((current) => current.map((item) => item.id === renamed.id ? renamed : item));
    if (draft.live2d.modelId === renamed.id) {
      setDraft((current) => ({
        ...current,
        live2d: { ...current.live2d, modelName: renamed.name },
      }));
    }
  };

  const deleteImported = async (model: AvatarModelSummary) => {
    try {
      await onDeleteAvatarModel(model.id);
      setAvatarModels((current) => current.filter((item) => item.id !== model.id));
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : notices.avatarRemoveFailed);
    }
  };

  const activeCapabilityResult = avatarCapabilityResult;
  const avatarCapabilities = activeCapabilityResult
    && activeCapabilityResult.modelId === draft.live2d.modelId
    ? activeCapabilityResult.capabilities
    : null;
  const avatarCapabilitiesError = activeCapabilityResult
    && activeCapabilityResult.modelId === draft.live2d.modelId
    ? activeCapabilityResult.error
    : false;
  const avatarCapabilitiesLoading = Boolean(draft.live2d.modelId)
    && activeCapabilityResult?.modelId !== draft.live2d.modelId;
  const activeAvatarBindings = live2DModelBindings(draft.live2d);
  const updateActiveAvatarBindings = (bindings: Live2DModelBindings) => {
    setDraft((current) => {
      const sourceKey = live2DSourceKey(current.live2d);
      return {
        ...current,
        live2d: {
          ...current.live2d,
          bindingProfiles: {
            ...current.live2d.bindingProfiles,
            [sourceKey]: bindings,
          },
        },
      };
    });
  };

  const saveStatus = saveState === "error" ? (
    <span className="text-[11px] font-semibold text-danger" role="status">{settingsCopy.saveError}</span>
  ) : saveState === "saving" ? (
    <span className="flex items-center gap-1.5 text-[11px] text-faint" role="status" aria-live="polite">
      <span className="size-1.5 animate-kana-pulse rounded-full bg-accent" aria-hidden="true" />
      {settingsCopy.savingChanges}
    </span>
  ) : appVersion ? (
    <span className="text-[11px] text-faint">{settingsCopy.version(appVersion)}</span>
  ) : null;
  const closeButton = (
    <button
      type="button"
      className="kana-focus grid size-9 shrink-0 place-items-center rounded-full bg-surface-strong text-muted transition-colors hover:text-ink"
      onClick={onClose}
      aria-label={settingsCopy.close}
    >
      <CloseIcon className="size-4" />
    </button>
  );

  return (
    <div className={`kana-modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-[var(--backdrop)] p-5 backdrop-blur-sm max-md:p-0 ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={settingsCopy.title} inert={closing || undefined}>
      <div
        className={`kana-settings-shell relative grid h-[min(760px,calc(100dvh-2.5rem))] w-full max-w-[980px] grid-cols-[228px_minmax(0,1fr)] overflow-hidden bg-raised kana-modal-panel max-md:h-dvh max-md:max-w-none max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)] ${closing ? "is-closing" : ""}`}
        ref={dialogRef as React.Ref<HTMLDivElement>}
        onKeyDown={onDialogKeyDown}
      >
        <aside className="flex min-h-0 flex-col border-r-[3px] border-dotted border-line-strong bg-surface-strong/35 px-3.5 pb-4 pt-6 max-md:border-b-[3px] max-md:border-r-0 max-md:bg-raised max-md:px-0 max-md:pb-0 max-md:pt-2">
          <div className="mb-4 flex items-center justify-between gap-3 px-3 max-md:mb-1 max-md:px-4">
            <h2 className="text-[22px] font-extrabold text-ink">{settingsCopy.title}</h2>
            <div className="md:hidden">{closeButton}</div>
          </div>
          {saveState === "error" ? <div className="px-4 pb-2 md:hidden">{saveStatus}</div> : null}
          <nav ref={navRef} className="kana-settings-nav flex flex-col gap-1 max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:px-3 max-md:pb-2" aria-label={settingsCopy.sectionsAria}>
            {navItems.map((item) => {
              const active = item.id === section;
              const NavIcon = SECTION_ICONS[item.id];
              return (
                <div key={item.id} className="max-md:shrink-0">
                  {item.id === "experience" || item.id === "model" ? (
                    <p className={`mb-1.5 px-3.5 text-[11.5px] font-extrabold text-muted max-md:hidden ${item.id === "model" ? "mt-5" : ""}`}>
                      {item.id === "model" ? settingsCopy.system : settingsCopy.personal}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSection(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`kana-settings-nav-item kana-focus flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] max-md:w-auto max-md:whitespace-nowrap max-md:py-2 ${active ? "is-active" : ""}`}
                  >
                    <NavIcon className="size-[18px] shrink-0" />
                    {item.label}
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="mt-auto px-3 pt-4 max-md:hidden">{saveStatus}</div>
        </aside>

        <div className="absolute right-5 top-5 z-10 max-md:hidden">{closeButton}</div>

        <main className="min-h-0 overflow-y-auto px-10 pb-12 pt-9 max-md:px-4 max-md:pb-8 max-md:pt-4">
          <div className="mx-auto max-w-[660px]">
            {section === "experience" ? (
              <SettingsGroup title={settingsCopy.sections.experience.label}>
                <SettingsRows>
                  <SettingsRow label={settingsCopy.interfaceTitle}>
                    <SettingsSegmented
                      label={settingsCopy.interfaceTitle}
                      value={draft.uiLocale}
                      options={[
                        { value: "id", label: "Bahasa Indonesia" },
                        { value: "en", label: "English" },
                      ]}
                      onChange={(uiLocale) => setDraft((current) => ({ ...current, uiLocale }))}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={settingsCopy.autoScrollTitle}
                    description={settingsCopy.autoScrollDescription}
                    inline
                  >
                    <Toggle
                      checked={draft.autoScroll}
                      label={settingsCopy.autoScrollTitle}
                      onChange={() =>
                        setDraft((current) => ({ ...current, autoScroll: !current.autoScroll }))
                      }
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={settingsCopy.composerDelayTitle}
                    description={settingsCopy.composerDelayDescription}
                    stacked
                    // The delay only exists in desktop focus mode.
                    className="max-lg:hidden"
                  >
                    <ComposerDelaySlider
                      locale={draft.uiLocale}
                      value={draft.composerCollapseDelaySeconds}
                      onChange={(composerCollapseDelaySeconds) =>
                        setDraft((current) => ({
                          ...current,
                          composerCollapseDelaySeconds,
                        }))
                      }
                    />
                  </SettingsRow>
                </SettingsRows>
              </SettingsGroup>
            ) : null}

            {section === "voice" ? (
              <>
                <SettingsGroup title={settingsCopy.sections.voice.label}>
                  <SettingsRows>
                    <SettingsRow label={settingsCopy.voiceTitle} inline>
                      <Toggle checked={draft.voiceEnabled} label={settingsCopy.voiceToggle} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                    </SettingsRow>
                  </SettingsRows>
                </SettingsGroup>
                <VoiceEnginePanel locale={draft.uiLocale} />
                {draft.voiceEnabled ? (
                  <VoicePanel
                    locale={draft.uiLocale}
                    selectedVoiceId={draft.voice.voiceId}
                    onVoiceSelect={(voiceId) => setDraft((current) => ({
                      ...current,
                      voice: { ...current.voice, voiceId },
                    }))}
                  />
                ) : null}
              </>
            ) : null}

            {section === "avatar" ? (
              <>
                <SettingsGroup>
                  <SettingsRows>
                    <SettingsRow label={settingsCopy.avatarVisible} inline>
                      <Toggle
                        checked={draft.avatarVisible}
                        label={settingsCopy.avatarVisible}
                        onChange={() => {
                          const next = { ...draft, avatarVisible: !draft.avatarVisible };
                          wipeAvatarModeChange(() => {
                            setDraft(next);
                            // The draft's effect saves after paint; saving here
                            // lands the mode change while the wave covers the
                            // screen. A failure is still reported by the queued
                            // save that follows.
                            void onSaveRef.current(next).catch(() => undefined);
                          });
                        }}
                      />
                    </SettingsRow>
                  </SettingsRows>
                </SettingsGroup>
                {/* Nothing to pick while the avatar is off: the wardrobe, its
                    import, and the model licence only matter once it shows. */}
                {draft.avatarVisible ? (
                <SettingsGroup title={settingsCopy.avatarLibrary}>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(event) => void importAvatar(Array.from(event.target.files ?? []))}
                    {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                  />
                  <WardrobeGrid label={settingsCopy.avatarLibrary}>
                    {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => (
                      <AvatarCard
                        key={sample.id}
                        name={sample.name}
                        portrait={avatarPortraits[sample.modelUrl]}
                        active={!draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl}
                        disabled={avatarBusy}
                        onSelect={() => void selectOfficialAvatar(index)}
                      />
                    ))}
                    {avatarModels.map((model) => (
                      <AvatarCard
                        key={model.id}
                        name={model.name}
                        portrait={avatarPortraits[model.id]}
                        active={draft.live2d.modelId === model.id}
                        disabled={avatarBusy}
                        onSelect={() => void selectImported(model)}
                        menu={{
                          label: settingsCopy.avatarOptions(model.name),
                          detail: `${(model.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
                          items: [
                            { label: settingsCopy.rename, onSelect: () => void renameImported(model) },
                            { label: settingsCopy.remove, danger: true, onSelect: () => void deleteImported(model) },
                          ],
                        }}
                      />
                    ))}
                    <AddCard
                      label={avatarBusy ? settingsCopy.preparingAvatar : settingsCopy.importLive2d}
                      busy={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    />
                  </WardrobeGrid>
                  {avatarNotice ? <p className="mt-3 text-[11px] leading-relaxed text-muted" role="status">{avatarNotice}</p> : null}
                </SettingsGroup>
                ) : null}

                {/* Intentionally not rendered: the avatar expression panel is
                    still untested, so this section is dead code for now. The
                    panel, its capability checks, bindings, and preview
                    handlers stay in place until those tests exist. */}

                <SettingsGroup title={settingsCopy.stageTitle}>
                  <input
                    ref={backgroundInputRef}
                    type="file"
                    className="sr-only"
                    accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.bmp,image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importStageBackground(file);
                    }}
                  />
                  <WardrobeGrid label={settingsCopy.stageAria} wide>
                    {STAGE_BACKGROUND_OPTIONS.map(({ value, previewClass }) => (
                      <StageBackgroundChoice
                        key={value}
                        active={draft.stageBackground === value}
                        label={settingsCopy.backgroundOptions[value].label}
                        previewClass={previewClass}
                        onSelect={() => setDraft((current) => ({
                          ...current,
                          stageBackground: value,
                        }))}
                        copy={settingsCopy}
                      />
                    ))}
                    {stageBackgrounds.map((background) => (
                      <StoredStageBackgroundChoice
                        key={background.id}
                        active={draft.stageBackground === "custom" && draft.customBackgroundId === background.id}
                        background={background}
                        onLoad={onLoadStageBackground}
                        onSelect={() => setDraft((current) => ({
                          ...current,
                          stageBackground: "custom",
                          customBackgroundId: background.id,
                        }))}
                        onRemove={() => void deleteStageBackground(background)}
                        copy={settingsCopy}
                      />
                    ))}
                    <AddCard
                      label={backgroundBusy ? settingsCopy.adding : settingsCopy.uploadImage}
                      busy={backgroundBusy}
                      wide
                      onClick={() => backgroundInputRef.current?.click()}
                    />
                  </WardrobeGrid>
                  {backgroundNotice ? (
                    <p className="mt-3 text-[11px] text-muted" role="status">{backgroundNotice}</p>
                  ) : null}
                </SettingsGroup>
              </>
            ) : null}

            {section === "model" ? (
              <>
                <SettingsGroup title={settingsCopy.modelTitle} ariaLabel={settingsCopy.modelTitle}>
                  <div className="mt-2">
                    <ModelControlPanel
                      locale={draft.uiLocale}
                      catalog={agentModelCatalog}
                      onList={onListAgentModels}
                      onSelect={onSelectAgentModel}
                      defaultModel={runtimeId ? draft.agentModelDefaults[runtimeId] ?? null : null}
                      onSetDefault={runtimeId
                        ? (choice) =>
                            setDraft((current) => ({
                              ...current,
                              agentModelDefaults: {
                                ...current.agentModelDefaults,
                                [runtimeId]: choice,
                              },
                            }))
                        : undefined}
                    />
                    <p className="mt-3 text-[11px] leading-relaxed text-faint">
                      {settingsCopy.modelDefaultScope}
                    </p>
                    <div className="mt-5 border-t border-line pt-3">
                      <button
                        type="button"
                        className="kana-focus group flex w-full items-center justify-between gap-3 rounded-[12px] py-2 text-left"
                        onClick={() => setSection("providers")}
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-ink transition-colors group-hover:text-accent-strong">
                            {settingsCopy.sections.providers.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted">
                            {settingsCopy.modelProvidersEntryDescription}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-muted transition-colors group-hover:text-accent-strong">
                          {settingsCopy.modelProvidersManage}
                          <ChevronRightIcon className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                    </div>
                  </div>
                </SettingsGroup>
              </>
            ) : null}

            {section === "providers" ? (
              <CustomModelManager
                copy={settingsCopy}
                onListProviders={onListHermesModelProviders}
                onSubmit={onAddHermesModel}
                onCatalogChanged={async () => {
                  await onListAgentModels(false);
                }}
              />
            ) : null}

            {section === "system" ? (
              <>
                <SettingsGroup title={settingsCopy.sections.system.label}>
                  <HermesControlPanel
                    locale={draft.uiLocale}
                    onInspect={() => onInspectHermesControl()}
                    onStart={onStartHermesControl}
                    onStop={onStopHermesControl}
                  />
                </SettingsGroup>
                <SettingsGroup title={settingsCopy.hostTitle} ariaLabel={settingsCopy.hostTitle}>
                  <div className="mt-2">
                    <HostPanel locale={draft.uiLocale} />
                  </div>
                </SettingsGroup>
                <AdvancedConfigCard locale={draft.uiLocale} />
              </>
            ) : null}

            {section === "privacy" ? (
              <SettingsGroup title={settingsCopy.accessTitle}>
                <SecuritySection locale={draft.uiLocale} />
              </SettingsGroup>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
