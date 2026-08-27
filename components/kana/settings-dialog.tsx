"use client";

import { useEffect, useRef, useState } from "react";
import type {
  KanaPreferences,
  StageBackground,
} from "@/lib/preferences/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type {
  StageBackgroundAsset,
  StageBackgroundSummary,
} from "@/lib/background/indexed-db-stage-background-store";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import {
  LIVE2D_SAMPLE_COPYRIGHT_NOTICE,
  OFFICIAL_LIVE2D_SAMPLES,
} from "@/lib/avatar/defaults";
import {
  changeAccessPassword,
  fetchAuthStatus,
  logoutAccessSession,
  type AuthStatus,
} from "@/lib/runtime/auth-client";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { getCopy, type Copy, type UiLocale } from "@/lib/ui/copy";
import { HermesControlPanel } from "./hermes-control-panel";
import { TtsControlPanel } from "./tts-control-panel";
import { VoicePanel } from "./voice-panel";
import {
  inspectTtsRuntime,
  controlTtsRuntime,
} from "@/lib/runtime/tts-control-client";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "./icons";
import {
  btnDangerGhost,
  btnGhost,
  btnSecondary,
  fieldLabel,
  inputBase,
  sectionEyebrow,
  Toggle,
} from "./ui";

type SettingsDialogProps = {
  preferences: KanaPreferences;
  onSave(preferences: KanaPreferences): Promise<void>;
  onImportAvatar(files: File[]): Promise<AvatarModelSummary>;
  onListAvatarModels(): Promise<AvatarModelSummary[]>;
  onSelectAvatarModel(id: string): Promise<AvatarModelSummary>;
  onRenameAvatarModel(id: string, name: string): Promise<AvatarModelSummary>;
  onDeleteAvatarModel(id: string): Promise<void>;
  onImportStageBackground(file: File): Promise<StageBackgroundSummary>;
  onListStageBackgrounds(): Promise<StageBackgroundSummary[]>;
  onLoadStageBackground(id: string): Promise<StageBackgroundAsset | null>;
  onDeleteStageBackground(id: string): Promise<void>;
  onInspectHermesControl(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: { port: number; cwd?: string; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  onClose(): void;
};

type SettingsSection = "experience" | "voice" | "avatar" | "system" | "privacy";

const NAV_IDS: SettingsSection[] = ["experience", "voice", "avatar", "system", "privacy"];

const STAGE_BACKGROUND_OPTIONS: Array<{
  value: StageBackground;
  previewClass: string;
}> = [
  { value: "plain", previewClass: "kana-background-preview-plain" },
  { value: "room", previewClass: "kana-background-preview-room" },
  { value: "pattern-sparkles", previewClass: "kana-background-preview-pattern-sparkles" },
  { value: "pattern-twinkle", previewClass: "kana-background-preview-pattern-twinkle" },
  { value: "pattern-gingham", previewClass: "kana-background-preview-pattern-gingham" },
  { value: "pattern-stars", previewClass: "kana-background-preview-pattern-stars" },
  { value: "pattern-swirls", previewClass: "kana-background-preview-pattern-swirls" },
];

type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  hint: string;
};

function StageBackgroundChoice({
  active,
  hint,
  label,
  onRemove,
  onSelect,
  previewClass,
  previewUrl,
  copy,
}: {
  active: boolean;
  hint: string;
  label: string;
  onRemove?: () => void;
  onSelect(): void;
  previewClass?: string;
  previewUrl?: string;
  copy: Copy["settings"];
}) {
  return (
    <div className={`relative min-w-0 shrink-0 basis-full snap-start overflow-hidden rounded-2xl border-2 transition-colors sm:basis-[calc((100%_-_1.5rem)/3)] ${
      active ? "border-accent bg-surface-strong" : "border-line bg-raised hover:border-line-strong"
    }`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`${label}. ${hint}`}
        className="kana-focus block w-full text-left"
        onClick={onSelect}
      >
        <span
          className={`block aspect-[16/9] border-b-2 border-line ${previewClass ?? "bg-bg"}`}
          style={previewUrl ? {
            backgroundImage: `url("${previewUrl}")`,
            backgroundPosition: "center",
            backgroundSize: "cover",
          } : undefined}
        />
        <span className="flex items-center justify-between gap-2 px-3 py-3">
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-ink">{label}</span>
            <span className="mt-0.5 block truncate text-[9px] text-muted">{hint}</span>
          </span>
          <span className={`shrink-0 text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
            {active ? copy.selected : copy.choose}
          </span>
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="kana-focus absolute top-2 right-2 flex size-8 items-center justify-center rounded-xl border-2 border-line-strong bg-raised/95 text-muted transition-colors hover:border-danger hover:text-danger"
          aria-label={copy.removeLabel(label)}
          onClick={onRemove}
        >
          <CloseIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function StoredStageBackgroundChoice({
  active,
  background,
  onLoad,
  onRemove,
  onSelect,
  copy,
}: {
  active: boolean;
  background: StageBackgroundSummary;
  onLoad(id: string): Promise<StageBackgroundAsset | null>;
  onRemove(): void;
  onSelect(): void;
  copy: Copy["settings"];
}) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    let activeLoad = true;
    let objectUrl: string | undefined;
    void onLoad(background.id).then((asset) => {
      if (!activeLoad || !asset) return;
      objectUrl = URL.createObjectURL(asset.content);
      setPreviewUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      activeLoad = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [background.id, onLoad]);

  return (
    <StageBackgroundChoice
      active={active}
      label={background.name}
      hint={copy.localBackground}
      previewUrl={previewUrl}
      onSelect={onSelect}
      onRemove={onRemove}
      copy={copy}
    />
  );
}

function SettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border-2 border-line bg-surface p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {description ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SecuritySection({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus({ authEnabled: false, authenticated: false }); });
    return () => { active = false; };
  }, []);

  if (!status) return <p className="text-[11px] text-muted">{copy.checkingAccess}</p>;

  if (!status.authEnabled) {
    return (
      <div className="rounded-xl border border-line bg-surface-strong p-3">
        <p className="text-xs font-bold text-ink">{copy.noPassword}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {copy.noPasswordBody}
        </p>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (newPassword.length < 8) {
      setError(copy.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await changeAccessPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(copy.passwordUpdated);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : copy.passwordFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className={fieldLabel}>{copy.currentPassword}</span>
        <input type="password" autoComplete="current-password" className={inputBase}
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={fieldLabel}>{copy.newPassword}</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className={fieldLabel}>{copy.confirmPassword}</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      </div>
      {error ? <p className="text-[11px] font-semibold text-danger" role="alert">{error}</p> : null}
      {success ? <p className="text-[11px] font-semibold text-accent-strong" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={busy || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submit()}>
          {busy ? copy.updating : copy.updatePassword}
        </button>
        <button type="button" className={btnDangerGhost} onClick={() => void logoutAccessSession()}>
          {copy.logout}
        </button>
      </div>
    </div>
  );
}

function AdvancedConfigCard({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const [configPath, setConfigPath] = useState("$KANA_DATA_DIR/config.json");
  useEffect(() => {
    let active = true;
    void fetch("/api/kana/config", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value: { path?: string } | null) => {
        if (active && value?.path) setConfigPath(value.path);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <details className="rounded-2xl border border-line bg-surface">
      <summary className="kana-focus cursor-pointer list-none px-4 py-4 text-xs font-bold text-ink [&::-webkit-details-marker]:hidden">
        {copy.advancedTitle}
        <span className="ml-2 font-normal text-muted">{copy.advancedSuffix}</span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        <p className="text-[11px] leading-relaxed text-muted">
          {copy.advancedBody}
        </p>
        <code className="mt-3 block overflow-x-auto rounded-xl border border-line bg-surface-strong px-3 py-2.5 text-[11px] text-accent-strong">
          {configPath}
        </code>
        <p className="mt-2 text-[10px] text-faint">{copy.advancedRestart}</p>
      </div>
    </details>
  );
}

export function SettingsDialog({
  preferences,
  onSave,
  onClose,
  onImportAvatar,
  onListAvatarModels,
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
}: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const copy = getCopy(draft.uiLocale);
  const settingsCopy = copy.settings;
  const navItems: SettingsNavItem[] = NAV_IDS.map((id) => ({
    id,
    ...settingsCopy.sections[id],
  }));
  const [section, setSection] = useState<SettingsSection>("experience");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [avatarModels, setAvatarModels] = useState<AvatarModelSummary[]>([]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [stageBackgrounds, setStageBackgrounds] = useState<StageBackgroundSummary[]>([]);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundCarouselRef = useRef<HTMLDivElement | null>(null);
  const initialDraftRef = useRef(true);
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
    const revision = ++saveRevisionRef.current;
    setSaveState("saving");
    const queuedSave = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSaveRef.current(draft));
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
      .catch((error) => { if (active) setAvatarNotice(error instanceof Error ? error.message : draft.uiLocale === "id" ? "Avatar tidak dapat dimuat." : "Could not load avatars."); });
    return () => { active = false; };
  }, [draft.uiLocale, onListAvatarModels, section]);

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
              : draft.uiLocale === "id" ? "Latar lokal tidak dapat dimuat." : "Could not load local backgrounds.",
          );
        }
      });
    return () => { active = false; };
  }, [draft.uiLocale, onListStageBackgrounds, section]);

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
    setAvatarNotice(draft.uiLocale === "id" ? `${sample.name} dipilih.` : `${sample.name} selected.`);
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
      setBackgroundNotice(draft.uiLocale === "id" ? `${imported.name} sekarang menjadi latar panggungmu.` : `${imported.name} is now your stage background.`);
    } catch (error) {
      setBackgroundNotice(
        error instanceof Error ? error.message : draft.uiLocale === "id" ? "Gambar ini tidak dapat diimpor." : "Could not import this image.",
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
      setBackgroundNotice(draft.uiLocale === "id" ? `${background.name} dihapus dari perangkat ini.` : `${background.name} was removed from this device.`);
    } catch (error) {
      setBackgroundNotice(
        error instanceof Error ? error.message : draft.uiLocale === "id" ? "Latar ini tidak dapat dihapus." : "Could not remove this background.",
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
      setDraft((current) => ({
        ...current,
        live2d: {
          ...current.live2d,
          modelId: imported.id,
          modelName: imported.name,
        },
      }));
      setAvatarModels(await onListAvatarModels());
      setAvatarNotice(draft.uiLocale === "id" ? `${imported.name} siap digunakan.` : `${imported.name} is ready to use.`);
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : draft.uiLocale === "id" ? "Avatar ini tidak dapat diimpor." : "Could not import this avatar.");
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
      setAvatarNotice(draft.uiLocale === "id" ? `${model.name} dipilih.` : `${model.name} selected.`);
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : draft.uiLocale === "id" ? "Avatar ini tidak dapat digunakan." : "Could not use this avatar.");
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
      setAvatarNotice(error instanceof Error ? error.message : draft.uiLocale === "id" ? "Avatar ini tidak dapat dihapus." : "Could not remove this avatar.");
    }
  };

  const currentNav = navItems.find((item) => item.id === section) ?? navItems[0];
  const activeOfficialAvatar = OFFICIAL_LIVE2D_SAMPLES.find(
    (sample) => !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl,
  );
  const activeAvatarName =
    draft.live2d.modelName || activeOfficialAvatar?.name || settingsCopy.selectedAvatar;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--backdrop)] p-3 backdrop-blur-md sm:p-5" role="dialog" aria-modal="true" aria-label={settingsCopy.title}>
      <div
        className="mx-auto grid h-[min(900px,calc(100dvh-2rem))] w-full max-w-6xl grid-cols-[260px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[24px] border-2 border-line-strong bg-raised max-md:grid-cols-1 max-md:grid-rows-[auto_auto_minmax(0,1fr)]"
        ref={dialogRef as React.Ref<HTMLDivElement>}
        onKeyDown={onDialogKeyDown}
      >
        <aside className="row-span-2 flex min-h-0 flex-col border-r-2 border-line bg-raised px-3 py-5 max-md:row-span-1 max-md:row-start-1 max-md:border-b-2 max-md:border-r-0 max-md:px-3 max-md:py-3">
          <div className="mb-8 min-h-11 px-3 max-md:mb-3">
            <div>
              <h2 className="text-lg font-bold text-ink">{settingsCopy.title}</h2>
              <p className="mt-1 text-[10px] text-muted">{settingsCopy.subtitle}</p>
            </div>
          </div>
          <p className="mb-2 px-3 text-[9px] font-bold tracking-[0.16em] text-faint uppercase max-md:hidden">{settingsCopy.personal}</p>
          <nav className="space-y-0.5 max-md:flex max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto" aria-label={settingsCopy.sectionsAria}>
            {navItems.map((item) => {
              const active = item.id === section;
              return (
                <div key={item.id}>
                  {item.id === "system" ? (
                    <p className="mb-2 mt-6 px-3 text-[9px] font-bold tracking-[0.16em] text-faint uppercase max-md:hidden">{settingsCopy.system}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={`kana-settings-nav-item kana-focus flex w-full items-center px-3 py-2.5 text-left transition-colors max-md:w-auto max-md:shrink-0 max-md:px-3 ${active ? "is-active" : ""}`}
                  >
                    <span>
                      <span className="block text-xs font-bold">{item.label}</span>
                      <span className="mt-0.5 block text-[9px] text-faint max-md:hidden">{item.hint}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>
        </aside>

        <header className="col-start-2 row-start-1 flex items-center justify-between border-b-2 border-line px-6 py-4 max-md:col-start-1 max-md:row-start-2 max-md:px-4">
          <div>
            <p className={sectionEyebrow}>{currentNav.hint}</p>
            <h2 className="mt-0.5 text-lg font-bold text-ink">{currentNav.label}</h2>
          </div>
          <div className="flex items-center gap-3">
            {saveState === "error" ? (
              <span className="text-[9px] font-semibold text-danger" role="status">{settingsCopy.saveError}</span>
            ) : null}
            <button type="button" className="kana-focus grid size-10 place-items-center rounded-xl border-2 border-line-strong bg-surface text-muted transition-colors hover:border-accent hover:text-ink" onClick={onClose} aria-label={settingsCopy.close}>
              <CloseIcon className="size-4" />
            </button>
          </div>
        </header>

        <main className="col-start-2 row-start-2 min-h-0 overflow-y-auto bg-bg p-4 sm:p-6 max-md:col-start-1 max-md:row-start-3">
          <div className="mx-auto max-w-3xl space-y-4">
            {section === "experience" ? (
              <>
                <SettingCard title={settingsCopy.interfaceTitle} description={settingsCopy.interfaceDescription}>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["id", "Bahasa Indonesia"],
                      ["en", "English"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`kana-focus rounded-xl border-2 px-3 py-3 text-left text-xs font-bold transition-colors ${
                          draft.uiLocale === value
                            ? "border-accent/45 bg-accent/12 text-accent-strong"
                            : "border-line bg-surface-strong text-ink-dim hover:border-line-strong"
                        }`}
                        onClick={() => setDraft((current) => ({ ...current, uiLocale: value }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingCard>
                <SettingCard title={settingsCopy.subtitleTitle} description={settingsCopy.subtitleDescription}>
                  <SubtitleLanguagePicker
                    locale={draft.uiLocale}
                    value={draft.subtitleLanguage}
                    onChange={(subtitleLanguage) => setDraft((current) => ({ ...current, subtitleLanguage }))}
                  />
                </SettingCard>
                <div className="rounded-xl border-2 border-accent/25 bg-surface px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-ink-dim">
                    {settingsCopy.historicalSubtitles}
                  </p>
                </div>
              </>
            ) : null}

            {section === "voice" ? (
              <section className="overflow-hidden rounded-2xl border-2 border-line bg-surface">
                <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
                    <div>
                      <p className="text-sm font-bold text-ink">{settingsCopy.voiceTitle}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        {draft.voiceEnabled
                          ? settingsCopy.voiceOn
                          : settingsCopy.voiceOff}
                      </p>
                    </div>
                    <Toggle checked={draft.voiceEnabled} label={settingsCopy.voiceToggle} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                </header>
                {draft.voiceEnabled ? (
                  <div className="border-t-2 border-line bg-raised p-4 sm:p-5">
                    <VoicePanel
                      locale={draft.uiLocale}
                      selectedVoiceId={draft.qwen3Tts.voiceId}
                      onVoiceSelect={(voiceId) => setDraft((current) => ({
                        ...current,
                        qwen3Tts: { ...current.qwen3Tts, voiceId },
                      }))}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {section === "avatar" ? (
              <>
                <SettingCard title={settingsCopy.stageTitle} description={settingsCopy.stageDescription}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold text-muted">
                      {settingsCopy.backgrounds(STAGE_BACKGROUND_OPTIONS.length + stageBackgrounds.length)}
                    </p>
                    <div className="flex items-center gap-2" aria-label={settingsCopy.carouselControls}>
                      <button
                        type="button"
                        className="kana-focus flex size-9 items-center justify-center rounded-xl border-2 border-line bg-surface-strong text-ink-dim transition-colors hover:border-accent hover:text-accent"
                        aria-label={settingsCopy.previousBackgrounds}
                        onClick={() => scrollBackgroundCarousel(-1)}
                      >
                        <ChevronLeftIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="kana-focus flex size-9 items-center justify-center rounded-xl border-2 border-line bg-surface-strong text-ink-dim transition-colors hover:border-accent hover:text-accent"
                        aria-label={settingsCopy.nextBackgrounds}
                        onClick={() => scrollBackgroundCarousel(1)}
                      >
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
                  <div className="mt-3 flex flex-col gap-3 rounded-xl border-2 border-dashed border-line-strong bg-raised px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-ink">{settingsCopy.customBackgroundTitle}</p>
                      <p className="mt-0.5 text-[9px] leading-relaxed text-muted">
                        {settingsCopy.customBackgroundHint}
                      </p>
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
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={backgroundBusy}
                      onClick={() => backgroundInputRef.current?.click()}
                    >
                      {backgroundBusy ? settingsCopy.adding : settingsCopy.uploadImage}
                    </button>
                  </div>
                  {backgroundNotice ? (
                    <p className="mt-2 text-[10px] font-semibold text-muted" role="status">
                      {backgroundNotice}
                    </p>
                  ) : null}
                </SettingCard>

              <section className="overflow-hidden rounded-2xl border-2 border-line bg-surface">
                <header className="border-b-2 border-line px-4 py-4 sm:px-5">
                  <p className="text-sm font-bold text-ink">{settingsCopy.avatarLibrary}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {settingsCopy.avatarLibraryBody}
                  </p>
                </header>

                <div className="border-b-2 border-line bg-surface-strong px-4 py-3 sm:px-5">
                  <p className="text-[9px] font-bold tracking-[0.14em] text-muted uppercase">{settingsCopy.currentAvatar}</p>
                  <div className="mt-1 flex items-center justify-between gap-4">
                    <p className="truncate text-base font-bold text-ink">{activeAvatarName}</p>
                    <span className="shrink-0 text-[10px] font-semibold text-accent">
                      {draft.live2d.modelId ? settingsCopy.yourAvatar : settingsCopy.included}
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  <p className="mb-2 text-[10px] font-bold text-ink-dim">{settingsCopy.includedAvatars}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                      const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                      return (
                        <button
                          key={sample.id}
                          type="button"
                          className={`kana-focus flex min-h-20 items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                            active
                              ? "border-accent bg-surface-strong"
                              : "border-line bg-surface-strong hover:border-line-strong"
                          }`}
                          onClick={() => void selectOfficialAvatar(index)}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-ink">{sample.name}</span>
                            <span className="mt-0.5 block text-[9px] text-muted">{settingsCopy.live2dSample}</span>
                          </span>
                          <span className={`text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
                            {active ? settingsCopy.selected : settingsCopy.choose}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mb-2 mt-5">
                    <p className="text-[10px] font-bold text-ink-dim">{settingsCopy.yourAvatars}</p>
                    <p className="mt-0.5 text-[9px] text-muted">{settingsCopy.storedBrowserOnly}</p>
                  </div>
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
                        <div key={model.id} className={`grid min-h-24 grid-rows-[1fr_auto] overflow-hidden rounded-xl border-2 ${
                          active ? "border-accent bg-surface-strong" : "border-line bg-surface-strong"
                        }`}>
                          <button type="button" className="kana-focus flex min-w-0 items-center justify-between gap-3 px-4 py-3 text-left" disabled={avatarBusy} onClick={() => void selectImported(model)}>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-ink">{model.name}</span>
                              <span className="mt-0.5 block text-[9px] text-muted">
                                {(model.sizeBytes / 1024 / 1024).toFixed(1)} MB
                              </span>
                            </span>
                            <span className={`text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
                              {active ? settingsCopy.selected : settingsCopy.choose}
                            </span>
                          </button>
                          <div className="flex justify-end border-t-2 border-line px-2 py-1">
                            <button type="button" className={btnGhost} onClick={() => void renameImported(model)}>{settingsCopy.rename}</button>
                            <button type="button" className={btnDangerGhost} onClick={() => void deleteImported(model)}>{settingsCopy.remove}</button>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="kana-focus min-h-24 rounded-xl border-2 border-dashed border-line-strong bg-surface px-4 py-3 text-left transition-colors hover:border-accent"
                      disabled={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <span className="block text-xs font-bold text-ink">
                        {avatarBusy ? settingsCopy.preparingAvatar : settingsCopy.importLive2d}
                      </span>
                      <span className="mt-1 block text-[9px] leading-relaxed text-muted">
                        {settingsCopy.importLive2dHint}
                      </span>
                    </button>
                  </div>

                  {avatarNotice ? <p className="mt-3 text-[11px] leading-relaxed text-muted" role="status">{avatarNotice}</p> : null}
                </div>

                <details className="border-t-2 border-line px-4 py-3 text-[9px] leading-relaxed text-faint sm:px-5">
                  <summary className="kana-focus cursor-pointer font-semibold text-muted marker:content-none [&::-webkit-details-marker]:hidden">
                    {settingsCopy.includedAvatarAbout}
                  </summary>
                  <p className="mt-2">{LIVE2D_SAMPLE_COPYRIGHT_NOTICE}</p>
                </details>
              </section>
              </>
            ) : null}

            {section === "system" ? (
              <>
                <SettingCard title={settingsCopy.hermesTitle} description={settingsCopy.hermesDescription}>
                  <HermesControlPanel
                    locale={draft.uiLocale}
                    onInspect={() => onInspectHermesControl()}
                    onStart={onStartHermesControl}
                    onStop={onStopHermesControl}
                  />
                </SettingCard>
                <SettingCard title={settingsCopy.voiceEngineTitle} description={settingsCopy.voiceEngineDescription}>
                  <TtsControlPanel
                    locale={draft.uiLocale}
                    onInspect={inspectTtsRuntime}
                    onStart={({ restart }) => controlTtsRuntime({ action: restart ? "restart" : "start" })}
                    onStop={() => controlTtsRuntime({ action: "stop" })}
                  />
                </SettingCard>
                <AdvancedConfigCard locale={draft.uiLocale} />
              </>
            ) : null}

            {section === "privacy" ? (
              <>
                <SettingCard title={settingsCopy.accessTitle} description={settingsCopy.accessDescription}>
                  <SecuritySection locale={draft.uiLocale} />
                </SettingCard>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <p className="text-xs font-bold text-ink">{settingsCopy.privateTitle}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {settingsCopy.privateBody}
                  </p>
                  </div>
              </>
            ) : null}
          </div>
        </main>

      </div>
    </div>
  );
}
