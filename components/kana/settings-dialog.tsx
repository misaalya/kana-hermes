"use client";

import { useEffect, useRef, useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { Live2DModelBindings } from "@/lib/avatar/live2d-avatar-provider";
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
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import type { Emotion } from "@/lib/presentation/types";
import {
  LIVE2D_SAMPLE_COPYRIGHT_NOTICE,
  OFFICIAL_LIVE2D_SAMPLES,
} from "@/lib/avatar/defaults";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { getCopy } from "@/lib/ui/copy";
import { HermesControlPanel } from "./hermes-control-panel";
import { VoiceEnginePanel } from "./voice-engine-panel";
import { VoicePanel } from "./voice-panel";
import { AvatarExpressionPanel } from "./avatar-expression-panel";
import { ModelControlPanel } from "./model-control-panel";
import { AdvancedConfigCard, SecuritySection } from "./settings-access-section";
import {
  STAGE_BACKGROUND_OPTIONS,
  StageBackgroundChoice,
  StoredStageBackgroundChoice,
} from "./settings-stage-background";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  LanguageIcon,
  LockIcon,
  PersonIcon,
  PlugIcon,
  SparkIcon,
  SpeakerIcon,
} from "./icons";
import { btnDangerGhost, btnGhost, Toggle } from "./ui";
import {
  settingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  SettingsSegmented,
} from "./settings-layout";

type SettingsDialogProps = {
  preferences: KanaPreferences;
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
  onPreviewAvatarEmotion(preferences: KanaPreferences, emotion: Emotion): Promise<void>;
  onPreviewAvatarTalking(preferences: KanaPreferences): Promise<void>;
  onClose(): void;
};

type SettingsSection = "experience" | "voice" | "avatar" | "model" | "system" | "privacy";

const NAV_IDS: SettingsSection[] = ["experience", "voice", "avatar", "model", "system", "privacy"];

const SECTION_ICONS: Record<SettingsSection, (props: { className?: string }) => React.ReactElement> = {
  experience: LanguageIcon,
  voice: SpeakerIcon,
  avatar: PersonIcon,
  model: SparkIcon,
  system: PlugIcon,
  privacy: LockIcon,
};

type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  hint: string;
};

export function SettingsDialog({
  preferences,
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
  onPreviewAvatarEmotion,
  onPreviewAvatarTalking,
}: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const copy = getCopy(draft.uiLocale);
  const settingsCopy = copy.settings;
  const notices = copy.settingsNotices;
  const navItems: SettingsNavItem[] = NAV_IDS.map((id) => ({
    id,
    ...settingsCopy.sections[id],
  }));
  const [section, setSection] = useState<SettingsSection>("experience");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [avatarModels, setAvatarModels] = useState<AvatarModelSummary[]>([]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [avatarCapabilityResult, setAvatarCapabilityResult] = useState<{
    modelId: string;
    capabilities: Live2DModelCapabilities | null;
    error: boolean;
  } | null>(null);
  const [stageBackgrounds, setStageBackgrounds] = useState<StageBackgroundSummary[]>([]);
  // null while unknown or when the configured provider needs no local engine.
  const [voiceEngineReady, setVoiceEngineReady] = useState<boolean | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundCarouselRef = useRef<HTMLDivElement | null>(null);
  const initialDraftRef = useRef(true);
  const lastDraftRef = useRef(draft);
  const saveRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

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

  useEffect(() => {
    if (section !== "avatar") return;
    let active = true;
    void onListAvatarModels()
      .then((models) => { if (active) setAvatarModels(models); })
      .catch((error) => { if (active) setAvatarNotice(error instanceof Error ? error.message : notices.avatarsLoadFailed); });
    return () => { active = false; };
  }, [notices.avatarsLoadFailed, onListAvatarModels, section]);

  useEffect(() => {
    if (section !== "avatar" || !draft.live2d.modelId) return;
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
  }, [draft.live2d.modelId, onInspectAvatarModel, section]);

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

  const scrollBackgroundCarousel = (direction: -1 | 1) => {
    const carousel = backgroundCarouselRef.current;
    if (!carousel) return;
    const gap = Number.parseFloat(getComputedStyle(carousel).columnGap) || 0;
    carousel.scrollBy({
      left: direction * (carousel.clientWidth + gap),
      behavior: "smooth",
    });
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
    if (!window.confirm(settingsCopy.removeBackgroundConfirm(background.name))) return;
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
    if (!window.confirm(settingsCopy.removeAvatarConfirm(model.name))) return;
    try {
      await onDeleteAvatarModel(model.id);
      setAvatarModels((current) => current.filter((item) => item.id !== model.id));
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : notices.avatarRemoveFailed);
    }
  };

  const activeOfficialAvatar = OFFICIAL_LIVE2D_SAMPLES.find(
    (sample) => !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl,
  );
  const activeAvatarName =
    draft.live2d.modelName || activeOfficialAvatar?.name || settingsCopy.selectedAvatar;
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

  const saveStatus = saveState === "error"
    ? <span className="text-[11px] font-semibold text-danger" role="status">{settingsCopy.saveError}</span>
    : (
      <span className="flex items-center gap-1.5 text-[11px] text-faint" role="status" aria-live="polite">
        {saveState === "saving" ? (
          <span className="size-1.5 animate-kana-pulse rounded-full bg-accent" aria-hidden="true" />
        ) : (
          <CheckIcon className="size-3" />
        )}
        {saveState === "saving" ? settingsCopy.savingChanges : settingsCopy.saved}
      </span>
    );
  const closeButton = (
    <button
      type="button"
      className="kana-focus grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-strong hover:text-ink"
      onClick={onClose}
      aria-label={settingsCopy.close}
    >
      <CloseIcon className="size-4" />
    </button>
  );
  const carouselButton =
    "kana-focus grid size-8 place-items-center rounded-lg border border-line-strong text-ink-dim transition-colors hover:bg-surface-strong hover:text-ink";
  const choiceCard = (active: boolean) =>
    `kana-focus flex min-h-16 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
      active ? "border-accent bg-accent/8" : "border-line-strong hover:bg-surface-strong/60"
    }`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--backdrop)] p-5 backdrop-blur-sm max-md:p-0" role="dialog" aria-modal="true" aria-label={settingsCopy.title}>
      <div
        className="relative grid h-[min(760px,calc(100dvh-2.5rem))] w-full max-w-[980px] grid-cols-[228px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-line-strong bg-raised kana-settings-shell max-md:h-dvh max-md:max-w-none max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)] max-md:rounded-none max-md:border-0"
        ref={dialogRef as React.Ref<HTMLDivElement>}
        onKeyDown={onDialogKeyDown}
      >
        <aside className="flex min-h-0 flex-col border-r border-line bg-surface-strong/35 px-3 pb-4 pt-5 max-md:border-b max-md:border-r-0 max-md:bg-raised max-md:px-0 max-md:pb-0 max-md:pt-2">
          <div className="mb-4 flex items-center justify-between gap-3 px-3 max-md:mb-1 max-md:px-4">
            <h2 className="text-[15px] font-bold text-ink">{settingsCopy.title}</h2>
            <div className="md:hidden">{closeButton}</div>
          </div>
          {saveState === "error" ? <div className="px-4 pb-2 md:hidden">{saveStatus}</div> : null}
          <nav className="kana-settings-nav flex flex-col gap-px max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:px-3 max-md:pb-2" aria-label={settingsCopy.sectionsAria}>
            {navItems.map((item) => {
              const active = item.id === section;
              const NavIcon = SECTION_ICONS[item.id];
              return (
                <div key={item.id} className="max-md:shrink-0">
                  {item.id === "experience" || item.id === "model" ? (
                    <p className={`mb-1 px-3 text-[11px] text-faint max-md:hidden ${item.id === "model" ? "mt-5" : ""}`}>
                      {item.id === "model" ? settingsCopy.system : settingsCopy.personal}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSection(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`kana-settings-nav-item kana-focus flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors max-md:w-auto max-md:whitespace-nowrap max-md:py-1.5 ${active ? "is-active" : ""}`}
                  >
                    <NavIcon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="mt-auto px-3 pt-4 max-md:hidden">{saveStatus}</div>
        </aside>

        <div className="absolute right-3 top-3 z-10 max-md:hidden">{closeButton}</div>

        <main className="min-h-0 overflow-y-auto px-10 pb-12 pt-9 max-md:px-4 max-md:pb-8 max-md:pt-4">
          <div className="mx-auto max-w-[660px]">
            {section === "experience" ? (
              <SettingsGroup title={settingsCopy.sections.experience.hint}>
                <SettingsRows>
                  <SettingsRow label={settingsCopy.interfaceTitle} description={settingsCopy.interfaceDescription}>
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
                  <SettingsRow label={settingsCopy.subtitleTitle} description={settingsCopy.subtitleDescription} />
                </SettingsRows>
              </SettingsGroup>
            ) : null}

            {section === "voice" ? (
              <>
                <SettingsGroup title={settingsCopy.sections.voice.label}>
                  <SettingsRows>
                    <SettingsRow
                      label={settingsCopy.voiceTitle}
                      description={draft.voiceEnabled ? settingsCopy.voiceOn : settingsCopy.voiceOff}
                    >
                      <Toggle checked={draft.voiceEnabled} label={settingsCopy.voiceToggle} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                    </SettingsRow>
                    <VoiceEnginePanel locale={draft.uiLocale} onReadyChange={setVoiceEngineReady} />
                  </SettingsRows>
                  {draft.voiceEnabled && voiceEngineReady === false ? (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-muted" role="status">
                      {copy.voiceEngine.notInstalledHint}
                    </p>
                  ) : null}
                </SettingsGroup>
                {draft.voiceEnabled ? (
                  <SettingsGroup>
                    <VoicePanel
                      locale={draft.uiLocale}
                      selectedVoiceId={draft.voice.voiceId}
                      onVoiceSelect={(voiceId) => setDraft((current) => ({
                        ...current,
                        voice: { ...current.voice, voiceId },
                      }))}
                    />
                  </SettingsGroup>
                ) : null}
              </>
            ) : null}

            {section === "avatar" ? (
              <>
                <SettingsGroup title={settingsCopy.stageTitle} description={settingsCopy.stageDescription}>
                  <div className="mb-2 mt-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-muted">
                      {settingsCopy.backgrounds(STAGE_BACKGROUND_OPTIONS.length + stageBackgrounds.length)}
                    </p>
                    <div className="flex items-center gap-1.5" aria-label={settingsCopy.carouselControls}>
                      <button type="button" className={carouselButton} aria-label={settingsCopy.previousBackgrounds} onClick={() => scrollBackgroundCarousel(-1)}>
                        <ChevronLeftIcon className="size-4" />
                      </button>
                      <button type="button" className={carouselButton} aria-label={settingsCopy.nextBackgrounds} onClick={() => scrollBackgroundCarousel(1)}>
                        <ChevronRightIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div
                    ref={backgroundCarouselRef}
                    className="kana-background-carousel flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1"
                    role="radiogroup"
                    aria-label={settingsCopy.stageAria}
                  >
                    {STAGE_BACKGROUND_OPTIONS.map(({ value, previewClass }) => {
                      const active = draft.stageBackground === value;
                      const option = settingsCopy.backgroundOptions[value];
                      return (
                        <StageBackgroundChoice
                          key={value}
                          active={active}
                          label={option.label}
                          hint={option.hint}
                          previewClass={previewClass}
                          onSelect={() => setDraft((current) => ({
                            ...current,
                            stageBackground: value,
                          }))}
                          copy={settingsCopy}
                        />
                      );
                    })}
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
                  </div>
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
                  <div className="mt-3">
                    <SettingsRows>
                      <SettingsRow label={settingsCopy.customBackgroundTitle} description={settingsCopy.customBackgroundHint}>
                        <button
                          type="button"
                          className={settingsButton}
                          disabled={backgroundBusy}
                          onClick={() => backgroundInputRef.current?.click()}
                        >
                          {backgroundBusy ? settingsCopy.adding : settingsCopy.uploadImage}
                        </button>
                      </SettingsRow>
                    </SettingsRows>
                  </div>
                  {backgroundNotice ? (
                    <p className="text-[11px] text-muted" role="status">{backgroundNotice}</p>
                  ) : null}
                </SettingsGroup>

                <SettingsGroup title={settingsCopy.avatarLibrary} description={settingsCopy.avatarLibraryBody}>
                  <SettingsRows>
                    <SettingsRow label={settingsCopy.currentAvatar} description={draft.live2d.modelId ? settingsCopy.yourAvatar : settingsCopy.included}>
                      <span className="max-w-56 truncate text-[13px] font-semibold text-ink">{activeAvatarName}</span>
                    </SettingsRow>
                    <SettingsRow label={settingsCopy.includedAvatars} stacked>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                          const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                          return (
                            <button
                              key={sample.id}
                              type="button"
                              className={choiceCard(active)}
                              onClick={() => void selectOfficialAvatar(index)}
                            >
                              <span className="min-w-0">
                                <span className="block text-[13px] font-semibold text-ink">{sample.name}</span>
                                <span className="mt-0.5 block text-[11px] text-muted">{settingsCopy.live2dSample}</span>
                              </span>
                              {active ? <CheckIcon className="size-4 shrink-0 text-accent-strong" /> : (
                                <span className="text-[11px] text-faint">{settingsCopy.choose}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </SettingsRow>
                    <SettingsRow label={settingsCopy.yourAvatars} description={settingsCopy.storedBrowserOnly} stacked>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        multiple
                        className="sr-only"
                        onChange={(event) => void importAvatar(Array.from(event.target.files ?? []))}
                        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        {avatarModels.map((model) => {
                          const active = draft.live2d.modelId === model.id;
                          return (
                            <div key={model.id} className={`overflow-hidden rounded-xl border ${active ? "border-accent bg-accent/8" : "border-line-strong"}`}>
                              <button type="button" className="kana-focus flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left" disabled={avatarBusy} onClick={() => void selectImported(model)}>
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-semibold text-ink">{model.name}</span>
                                  <span className="mt-0.5 block text-[11px] text-muted">
                                    {(model.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                  </span>
                                </span>
                                {active ? <CheckIcon className="size-4 shrink-0 text-accent-strong" /> : (
                                  <span className="text-[11px] text-faint">{settingsCopy.choose}</span>
                                )}
                              </button>
                              <div className="flex justify-end gap-1 border-t border-line px-2 py-1">
                                <button type="button" className={btnGhost} onClick={() => void renameImported(model)}>{settingsCopy.rename}</button>
                                <button type="button" className={btnDangerGhost} onClick={() => void deleteImported(model)}>{settingsCopy.remove}</button>
                              </div>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="kana-focus min-h-16 rounded-xl border border-dashed border-line-strong px-4 py-3 text-left transition-colors hover:bg-surface-strong/60"
                          disabled={avatarBusy}
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <span className="block text-[13px] font-semibold text-ink">
                            {avatarBusy ? settingsCopy.preparingAvatar : settingsCopy.importLive2d}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                            {settingsCopy.importLive2dHint}
                          </span>
                        </button>
                      </div>
                      {avatarNotice ? <p className="mt-3 text-[11px] leading-relaxed text-muted" role="status">{avatarNotice}</p> : null}
                    </SettingsRow>
                  </SettingsRows>
                  <details className="mt-1 text-[11px] leading-relaxed text-faint">
                    <summary className="kana-details-summary kana-focus cursor-pointer text-muted hover:text-ink">
                      {settingsCopy.includedAvatarAbout}
                    </summary>
                    <p className="mt-2">{LIVE2D_SAMPLE_COPYRIGHT_NOTICE}</p>
                  </details>
                </SettingsGroup>

                {draft.live2d.modelId ? (
                  avatarCapabilitiesLoading ? (
                    <SettingsGroup title={settingsCopy.avatarBehaviorTitle}>
                      <p className="text-[11px] text-muted" role="status">{settingsCopy.avatarBehaviorLoading}</p>
                    </SettingsGroup>
                  ) : avatarCapabilitiesError || !avatarCapabilities ? (
                    <SettingsGroup title={settingsCopy.avatarBehaviorTitle}>
                      <p className="text-[11px] text-danger" role="status">{settingsCopy.avatarBehaviorFailed}</p>
                    </SettingsGroup>
                  ) : (
                    <SettingsGroup>
                      <AvatarExpressionPanel
                        bindings={activeAvatarBindings}
                        capabilities={avatarCapabilities}
                        copy={settingsCopy}
                        onChange={updateActiveAvatarBindings}
                        onPreview={(emotion) => onPreviewAvatarEmotion(draft, emotion)}
                        onPreviewTalking={() => onPreviewAvatarTalking(draft)}
                      />
                    </SettingsGroup>
                  )
                ) : (
                  <SettingsGroup title={settingsCopy.avatarBehaviorTitle} description={settingsCopy.avatarBehaviorBuiltin} />
                )}
              </>
            ) : null}

            {section === "model" ? (
              <SettingsGroup title={settingsCopy.modelTitle} description={settingsCopy.modelDescription}>
                <div className="mt-2">
                  <ModelControlPanel
                    locale={draft.uiLocale}
                    catalog={agentModelCatalog}
                    onList={onListAgentModels}
                    onSelect={onSelectAgentModel}
                  />
                </div>
              </SettingsGroup>
            ) : null}

            {section === "system" ? (
              <>
                <SettingsGroup title={settingsCopy.sections.system.hint}>
                  <SettingsRows>
                    <HermesControlPanel
                      locale={draft.uiLocale}
                      onInspect={() => onInspectHermesControl()}
                      onStart={onStartHermesControl}
                      onStop={onStopHermesControl}
                    />
                  </SettingsRows>
                </SettingsGroup>
                <AdvancedConfigCard locale={draft.uiLocale} />
              </>
            ) : null}

            {section === "privacy" ? (
              <>
                <SettingsGroup title={settingsCopy.accessTitle} description={settingsCopy.accessDescription}>
                  <SecuritySection locale={draft.uiLocale} />
                </SettingsGroup>
                <SettingsGroup title={settingsCopy.privateTitle} description={settingsCopy.privateBody} />
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
