import { useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { Emotion } from "@/lib/presentation/types";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import type { VoiceDescriptor } from "@/lib/voice/types";
import type { CreateVoiceCloneInput } from "@/lib/voice/qwen3-tts-contract";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { SUPPORTED_SUBTITLE_LANGUAGES } from "@/lib/presentation/languages";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";

type SettingsDialogProps = {
  preferences: KanaPreferences;
  diagnostics: string;
  voiceRuntimeState: string;
  voiceCanReplay: boolean;
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
  onInspectHermesControl(): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: { port: number; token: string; cwd?: string; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  onPrepareHermesCommand(command: string): void;
  onReplayVoice(): Promise<void>;
  onStopVoice(): void;
  onExportBackup(): string;
  onImportBackup(text: string): Promise<{ importedConversations: number; totalConversations: number }>;
  onClose(): void;
};

export function SettingsDialog({ preferences, onSave, onClose }: SettingsDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);
  const [draft, setDraft] = useState(() => ({ ...preferences }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave(draft); onClose(); } finally { setSaving(false); }
  };

  const toggleVoice = () => setDraft((prev) => ({ ...prev, voiceEnabled: !prev.voiceEnabled }));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-dialog" ref={dialogRef as React.Ref<HTMLDivElement>} onKeyDown={onDialogKeyDown}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <div className="settings-body">
          <div className="setting-row">
            <label>Subtitle language</label>
            <select
              value={draft.subtitleLanguage}
              onChange={(e) => setDraft((prev) => ({ ...prev, subtitleLanguage: e.target.value }))}
            >
              {SUPPORTED_SUBTITLE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.nativeLabel}</option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <label>Voice</label>
            <div
              className={`toggle-switch${draft.voiceEnabled ? " on" : ""}`}
              onClick={toggleVoice}
              role="switch"
              aria-checked={draft.voiceEnabled}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleVoice(); }}
            />
          </div>

          <div className="setting-row">
            <label>Avatar</label>
            <span className="value">{preferences.avatarMode === "live2d" ? "Live2D" : "Offline"}</span>
          </div>

          <details className="details-toggle">
            <summary>Connection</summary>
            <div className="details-body">
              <label>
                WebSocket URL
                <input
                  type="text"
                  value={draft.hermes.websocketUrl}
                  onChange={(e) => setDraft((prev) => ({ ...prev, hermes: { ...prev.hermes, websocketUrl: e.target.value } }))}
                />
              </label>
              <label>
                Session token
                <input
                  type="password"
                  value={draft.hermes.token}
                  autoComplete="off"
                  onChange={(e) => setDraft((prev) => ({ ...prev, hermes: { ...prev.hermes, token: e.target.value } }))}
                />
              </label>
            </div>
          </details>
        </div>

        <div className="settings-footer">
          <span>Kana · v{preferences.live2d.modelUrl ? "Live2D" : "base"}</span>
          <div className="settings-footer-actions">
            <button className="secondary-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}