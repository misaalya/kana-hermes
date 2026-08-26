"use client";

import { useEffect, useRef, useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
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
import { HermesControlPanel } from "./hermes-control-panel";
import { TtsControlPanel } from "./tts-control-panel";
import { VoicePanel } from "./voice-panel";
import {
  inspectTtsRuntime,
  controlTtsRuntime,
} from "@/lib/runtime/tts-control-client";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import {
  btnDangerGhost,
  btnGhost,
  btnSecondary,
  fieldLabel,
  inputBase,
  sectionEyebrow,
} from "./ui";

type SettingsDialogProps = {
  preferences: KanaPreferences;
  onSave(preferences: KanaPreferences): Promise<void>;
  onImportAvatar(files: File[]): Promise<AvatarModelSummary>;
  onListAvatarModels(): Promise<AvatarModelSummary[]>;
  onSelectAvatarModel(id: string): Promise<AvatarModelSummary>;
  onRenameAvatarModel(id: string, name: string): Promise<AvatarModelSummary>;
  onDeleteAvatarModel(id: string): Promise<void>;
  onInspectHermesControl(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: { port: number; cwd?: string; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  onClose(): void;
};

type SettingsSection = "experience" | "voice" | "avatar" | "system" | "privacy";

const NAV_ITEMS: Array<{
  id: SettingsSection;
  label: string;
  hint: string;
}> = [
  { id: "experience", label: "Experience", hint: "Language and subtitles" },
  { id: "voice", label: "Voice", hint: "How Kana sounds" },
  { id: "avatar", label: "Avatar", hint: "How Kana appears" },
  { id: "system", label: "Connection", hint: "Hermes and voice engine" },
  { id: "privacy", label: "Privacy", hint: "Access and security" },
];

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
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
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

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`kana-focus relative h-7 w-12 shrink-0 rounded-sm border transition-colors ${
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-strong"
      }`}
    >
      <span className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-[2px] transition-all ${
        checked ? "left-[25px] bg-on-accent" : "left-[3px] bg-muted"
      }`} />
    </button>
  );
}

function SecuritySection() {
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

  if (!status) return <p className="text-[11px] text-muted">Checking access protection…</p>;

  if (!status.authEnabled) {
    return (
      <div className="rounded-xl border border-line bg-surface-strong p-3">
        <p className="text-xs font-bold text-ink">No password required</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          This Kana installation currently opens without a password. Advanced access configuration lives in the Kana config file.
        </p>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (newPassword.length < 8) {
      setError("Use at least 8 characters for the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changeAccessPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className={fieldLabel}>Current password</span>
        <input type="password" autoComplete="current-password" className={inputBase}
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={fieldLabel}>New password</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className={fieldLabel}>Confirm password</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      </div>
      {error ? <p className="text-[11px] font-semibold text-danger" role="alert">{error}</p> : null}
      {success ? <p className="text-[11px] font-semibold text-accent-strong" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={busy || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submit()}>
          {busy ? "Updating…" : "Update password"}
        </button>
        <button type="button" className={btnDangerGhost} onClick={() => void logoutAccessSession()}>
          Log out
        </button>
      </div>
    </div>
  );
}

function AdvancedConfigCard() {
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
        Advanced configuration
        <span className="ml-2 font-normal text-muted">for self-hosted setups</span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        <p className="text-[11px] leading-relaxed text-muted">
          Runtime paths and ports can be configured outside the interface. Kana reads this file when starting its services:
        </p>
        <code className="mt-3 block overflow-x-auto rounded-xl border border-line bg-surface-strong px-3 py-2.5 text-[11px] text-accent-strong">
          {configPath}
        </code>
        <p className="mt-2 text-[10px] text-faint">Restart Kana after changing this file.</p>
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
  onInspectHermesControl,
  onStartHermesControl,
  onStopHermesControl,
}: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const [section, setSection] = useState<SettingsSection>("experience");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [avatarModels, setAvatarModels] = useState<AvatarModelSummary[]>([]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
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
      .catch((error) => { if (active) setAvatarNotice(error instanceof Error ? error.message : "Could not load avatars."); });
    return () => { active = false; };
  }, [onListAvatarModels, section]);

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
    setAvatarNotice(`${sample.name} selected.`);
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
      setAvatarNotice(`${imported.name} is ready to use.`);
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : "Could not import this avatar.");
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
      setAvatarNotice(`${model.name} selected.`);
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : "Could not use this avatar.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const renameImported = async (model: AvatarModelSummary) => {
    const name = window.prompt("Avatar name", model.name);
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
    if (!window.confirm(`Remove “${model.name}” from this browser?`)) return;
    try {
      await onDeleteAvatarModel(model.id);
      setAvatarModels((current) => current.filter((item) => item.id !== model.id));
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : "Could not remove this avatar.");
    }
  };

  const currentNav = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0];
  const activeOfficialAvatar = OFFICIAL_LIVE2D_SAMPLES.find(
    (sample) => !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl,
  );
  const activeAvatarName =
    draft.live2d.modelName || activeOfficialAvatar?.name || "Selected avatar";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--backdrop)] p-3 backdrop-blur-md sm:p-5" role="dialog" aria-modal="true" aria-label="Settings">
      <div
        className="mx-auto grid h-[min(900px,calc(100dvh-2rem))] w-full max-w-6xl grid-cols-[250px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl max-md:grid-cols-1 max-md:grid-rows-[auto_auto_minmax(0,1fr)]"
        ref={dialogRef as React.Ref<HTMLDivElement>}
        onKeyDown={onDialogKeyDown}
      >
        <aside className="row-span-2 flex min-h-0 flex-col border-r border-line bg-surface p-4 max-md:row-span-1 max-md:row-start-1 max-md:border-b max-md:border-r-0 max-md:p-3">
          <div className="mb-7 flex items-center gap-3 px-2 max-md:mb-2">
            <button type="button" className="kana-focus min-h-9 px-2 text-[11px] font-semibold text-muted hover:bg-surface-strong hover:text-ink" onClick={onClose} aria-label="Back to Kana">
              Back
            </button>
            <div>
              <p className={sectionEyebrow}>Kana</p>
              <h2 className="text-base font-bold text-ink">Settings</h2>
            </div>
          </div>
          <nav className="space-y-1 max-md:flex max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto" aria-label="Settings sections">
            {NAV_ITEMS.map((item) => {
              const active = item.id === section;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`kana-focus flex w-full items-center px-3 py-2.5 text-left transition-colors max-md:w-auto max-md:shrink-0 ${
                    active ? "bg-accent/14 text-accent-strong" : "text-muted hover:bg-surface-strong hover:text-ink"
                  }`}
                >
                  <span>
                    <span className="block text-xs font-bold">{item.label}</span>
                    <span className="mt-0.5 block text-[9px] text-faint max-md:hidden">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <header className="col-start-2 row-start-1 flex items-center justify-between border-b border-line px-6 py-4 max-md:col-start-1 max-md:row-start-2 max-md:px-4">
          <div>
            <p className={sectionEyebrow}>{currentNav.hint}</p>
            <h2 className="mt-0.5 text-lg font-bold text-ink">{currentNav.label}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[9px] font-semibold ${saveState === "error" ? "text-danger" : "text-faint"}`} role="status">
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save" : "Saved automatically"}
            </span>
            <button type="button" className="kana-focus min-h-9 px-2 text-[11px] font-semibold text-muted hover:bg-surface-strong hover:text-ink" onClick={onClose} aria-label="Close settings">
              Close
            </button>
          </div>
        </header>

        <main className="col-start-2 row-start-2 min-h-0 overflow-y-auto bg-bg p-4 sm:p-6 max-md:col-start-1 max-md:row-start-3">
          <div className="mx-auto max-w-3xl space-y-4">
            {section === "experience" ? (
              <>
                <SettingCard title="Interface language" description="Choose the language used by Kana's controls and menus.">
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["id", "Bahasa Indonesia"],
                      ["en", "English"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`kana-focus rounded-xl border px-3 py-3 text-left text-xs font-bold transition-colors ${
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
                <SettingCard title="Subtitle language" description="Kana always speaks Japanese. This controls the written subtitle for new replies.">
                  <SubtitleLanguagePicker
                    value={draft.subtitleLanguage}
                    onChange={(subtitleLanguage) => setDraft((current) => ({ ...current, subtitleLanguage }))}
                  />
                </SettingCard>
                <div className="border border-accent/25 bg-surface px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-ink-dim">
                    Existing subtitles stay exactly as you first saw them.
                  </p>
                </div>
              </>
            ) : null}

            {section === "voice" ? (
              <section className="overflow-hidden rounded-2xl border border-line bg-surface">
                <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
                    <div>
                      <p className="text-sm font-bold text-ink">Kana&apos;s voice</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        {draft.voiceEnabled
                          ? "Kana speaks new replies in Japanese."
                          : "Replies remain available as text while voice is off."}
                      </p>
                    </div>
                    <Toggle checked={draft.voiceEnabled} label="Japanese voice" onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                </header>
                {draft.voiceEnabled ? (
                  <div className="border-t border-line p-4 sm:p-5">
                    <VoicePanel
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
              <section className="overflow-hidden rounded-2xl border border-line bg-surface">
                <header className="border-b border-line px-4 py-4 sm:px-5">
                  <p className="text-sm font-bold text-ink">Avatar library</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Choose an included character or import your own Live2D avatar.
                  </p>
                </header>

                <div className="border-b border-line bg-surface-strong px-4 py-3 sm:px-5">
                  <p className="text-[9px] font-bold tracking-[0.14em] text-muted uppercase">Current avatar</p>
                  <div className="mt-1 flex items-center justify-between gap-4">
                    <p className="truncate text-base font-bold text-ink">{activeAvatarName}</p>
                    <span className="shrink-0 text-[10px] font-semibold text-accent">
                      {draft.live2d.modelId ? "Your avatar" : "Included"}
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  <p className="mb-2 text-[10px] font-bold text-ink-dim">Included avatars</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                      const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                      return (
                        <button
                          key={sample.id}
                          type="button"
                          className={`kana-focus flex min-h-20 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                            active
                              ? "border-accent bg-surface-strong"
                              : "border-line bg-surface-strong hover:border-line-strong"
                          }`}
                          onClick={() => void selectOfficialAvatar(index)}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-ink">{sample.name}</span>
                            <span className="mt-0.5 block text-[9px] text-muted">Live2D sample</span>
                          </span>
                          <span className={`text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
                            {active ? "Selected" : "Choose"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mb-2 mt-5">
                    <p className="text-[10px] font-bold text-ink-dim">Your avatars</p>
                    <p className="mt-0.5 text-[9px] text-muted">Stored only in this browser.</p>
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
                        <div key={model.id} className={`grid min-h-24 grid-rows-[1fr_auto] overflow-hidden rounded-xl border ${
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
                              {active ? "Selected" : "Choose"}
                            </span>
                          </button>
                          <div className="flex justify-end border-t border-line px-2 py-1">
                            <button type="button" className={btnGhost} onClick={() => void renameImported(model)}>Rename</button>
                            <button type="button" className={btnDangerGhost} onClick={() => void deleteImported(model)}>Remove</button>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="kana-focus min-h-24 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3 text-left transition-colors hover:border-accent/45"
                      disabled={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <span className="block text-xs font-bold text-ink">
                        {avatarBusy ? "Preparing avatar…" : "Import Live2D folder"}
                      </span>
                      <span className="mt-1 block text-[9px] leading-relaxed text-muted">
                        Select one complete model folder. Kana keeps it on this device.
                      </span>
                    </button>
                  </div>

                  {avatarNotice ? <p className="mt-3 text-[11px] leading-relaxed text-muted" role="status">{avatarNotice}</p> : null}
                </div>

                <details className="border-t border-line px-4 py-3 text-[9px] leading-relaxed text-faint sm:px-5">
                  <summary className="kana-focus cursor-pointer font-semibold text-muted marker:content-none [&::-webkit-details-marker]:hidden">
                    About included avatars
                  </summary>
                  <p className="mt-2">{LIVE2D_SAMPLE_COPYRIGHT_NOTICE}</p>
                </details>
              </section>
            ) : null}

            {section === "system" ? (
              <>
                <SettingCard title="Hermes" description="The agent brain behind Kana. Kana finds and connects it automatically.">
                  <HermesControlPanel
                    locale={draft.uiLocale}
                    onInspect={() => onInspectHermesControl()}
                    onStart={onStartHermesControl}
                    onStop={onStopHermesControl}
                  />
                </SettingCard>
                <SettingCard title="Voice engine" description="The local service that turns Kana's Japanese text into speech.">
                  <TtsControlPanel
                    locale={draft.uiLocale}
                    onInspect={inspectTtsRuntime}
                    onStart={({ restart }) => controlTtsRuntime({ action: restart ? "restart" : "start" })}
                    onStop={() => controlTtsRuntime({ action: "stop" })}
                  />
                </SettingCard>
                <AdvancedConfigCard />
              </>
            ) : null}

            {section === "privacy" ? (
              <>
                <SettingCard title="Access protection" description="Control who can open this Kana installation.">
                  <SecuritySection />
                </SettingCard>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <p className="text-xs font-bold text-ink">Your private values stay private</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Passwords and secrets requested by Hermes are sent directly to Hermes and never added to conversation history or preferences.
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
