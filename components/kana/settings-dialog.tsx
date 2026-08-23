"use client";

import { useEffect, useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { Emotion } from "@/lib/presentation/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import type { VoiceDescriptor } from "@/lib/voice/types";
import type { CreateVoiceCloneInput } from "@/lib/voice/qwen3-tts-contract";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import {
  changeAccessPassword,
  fetchAuthStatus,
  logoutAccessSession,
  type AuthStatus,
} from "@/lib/runtime/auth-client";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { HermesControlPanel } from "./hermes-control-panel";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnGhost, btnPrimary, btnSecondary, bentoCard, btnDangerGhost, inputBase, fieldLabel } from "./ui";

type SettingsDialogProps = {
  preferences: KanaPreferences;
  onSave(preferences: KanaPreferences): Promise<void>;
  onImportAvatar(files: File[]): Promise<AvatarModelSummary>;
  onListAvatarModels(): Promise<AvatarModelSummary[]>;
  onSelectAvatarModel(id: string): Promise<AvatarModelSummary>;
  onRenameAvatarModel(id: string, name: string): Promise<AvatarModelSummary>;
  onDeleteAvatarModel(id: string): Promise<void>;
  onPreviewAvatarEmotion(preferences: KanaPreferences, emotion: Emotion): Promise<void>;
  onPreviewAvatarMotion(preferences: KanaPreferences, motion: string): Promise<void>;
  onPreviewAvatarTalking(preferences: KanaPreferences): Promise<void>;
  onInspectVoice(baseUrl: string): Promise<VoiceProviderStatus>;
  onCloneVoice(baseUrl: string, input: CreateVoiceCloneInput): Promise<VoiceDescriptor>;
  onDeleteClonedVoice(baseUrl: string, voiceId: string): Promise<VoiceProviderStatus>;
  onInspectHermesControl(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: { port: number; cwd?: string; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  onClose(): void;
};

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

  if (!status) {
    return <p className="text-[11px] text-faint">Checking security status…</p>;
  }

  if (!status.authEnabled) {
    return (
      <p className="text-[11px] leading-relaxed text-faint">
        Password protection is off. Set <code className="font-mono text-muted">KANA_ACCESS_PASSWORD</code> and
        restart Kana to require login on this machine.
      </p>
    );
  }

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (newPassword.length < 8) {
      setError("The new password must contain at least 8 characters.");
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
      setSuccess("Password updated. Use it on your next login.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Current password</span>
        <input type="password" autoComplete="current-password" className={inputBase}
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>New password</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Confirm new password</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      </div>
      {error ? <p className="text-[11px] font-semibold text-danger" role="alert">{error}</p> : null}
      {success ? <p className="text-[11px] font-semibold text-accent-strong" role="status">{success}</p> : null}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy || !currentPassword || !newPassword || !confirmPassword}
          onClick={() => void submit()}
        >
          {busy ? "Updating…" : "Update password"}
        </button>
        <button type="button" className={btnDangerGhost} onClick={() => void logoutAccessSession()}>
          Log out
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog({
  preferences,
  onSave,
  onClose,
  onInspectHermesControl,
  onStartHermesControl,
  onStopHermesControl,
}: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  const [draft, setDraft] = useState(() => ({ ...preferences }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave(draft); onClose(); } finally { setSaving(false); }
  };

  const toggleVoice = () => setDraft((prev) => ({ ...prev, voiceEnabled: !prev.voiceEnabled }));

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg/80 p-3" role="dialog" aria-modal="true" aria-label="Settings">
      <div
        className="max-h-[90dvh] w-[min(680px,100%)] overflow-y-auto rounded-3xl border border-line bg-bg p-3"
        ref={dialogRef as React.Ref<HTMLDivElement>}
        onKeyDown={onDialogKeyDown}
      >
        {/* Bento header tile */}
        <div className={`mb-2 flex items-center justify-between ${bentoCard}`}>
          <h2 className="text-sm font-bold tracking-wide text-ink uppercase">Settings</h2>
          <button type="button" className="px-1.5 text-xl leading-none text-muted transition-colors hover:text-accent-strong" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          {/* Presentation tiles */}
          <div className={`${bentoCard} flex flex-col gap-4`}>
            <div>
              <h3 className="mb-2.5 text-[11px] font-bold tracking-wider text-ink-dim uppercase">Subtitle language</h3>
              <SubtitleLanguagePicker
                value={draft.subtitleLanguage}
                onChange={(subtitleLanguage) => setDraft((prev) => ({ ...prev, subtitleLanguage }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className={`${bentoCard} flex items-center justify-between`}>
              <div>
                <p className="text-xs font-bold text-ink">Japanese voice</p>
                <p className="text-[10px] text-faint">Qwen3-TTS local service</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.voiceEnabled}
                onClick={toggleVoice}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") toggleVoice(); }}
                className={`relative h-5.5 w-10 shrink-0 rounded-full border transition-colors ${draft.voiceEnabled ? "border-accent bg-accent" : "border-line-strong bg-transparent"}`}
              >
                <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all ${draft.voiceEnabled ? "left-[22px] bg-on-accent" : "left-1 bg-muted"}`} />
              </button>
            </div>

            <div className={`${bentoCard} flex items-center justify-between`}>
              <div>
                <p className="text-xs font-bold text-ink">Avatar</p>
                <p className="text-[10px] text-faint">Live2D model</p>
              </div>
              <span className="rounded-full border border-line-strong px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">
                Live2D
              </span>
            </div>

            {/* Security tile */}
            <details className={`${bentoCard}`}>
              <summary className="cursor-pointer text-xs font-bold text-ink-dim marker:content-none [&::-webkit-details-marker]:hidden">
                Security
              </summary>
              <div className="pt-3">
                <SecuritySection />
              </div>
            </details>
          </div>

          {/* Hermes gateway tile */}
          <details className={`${bentoCard} lg:col-span-2`} open>
            <summary className="cursor-pointer text-xs font-bold text-ink-dim marker:content-none [&::-webkit-details-marker]:hidden">
              Hermes gateway
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              <p className="text-[11px] leading-relaxed text-faint">
                Kana memroses koneksi Hermes di server. Browser tidak menyimpan
                token sesi — semuanya ditangani otomatis oleh relay Kana.
              </p>
              <HermesControlPanel
                cwd={draft.hermes.cwd ?? ""}
                onCwdChange={(cwd) => setDraft((prev) => ({ ...prev, hermes: { ...prev.hermes, cwd } }))}
                onInspect={() => onInspectHermesControl()}
                onStart={onStartHermesControl}
                onStop={onStopHermesControl}
              />
            </div>
          </details>
        </div>

        {/* Footer tile */}
        <div className={`mt-2 flex items-center justify-between ${bentoCard}`}>
          <span className="text-[10px] text-faint">Kana · Hermes, with a face and a voice</span>
          <div className="flex items-center gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
