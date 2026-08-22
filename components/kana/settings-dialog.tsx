import { useEffect, useState } from "react";
import {
  LIVE2D_SAMPLE_COPYRIGHT_NOTICE,
  OFFICIAL_LIVE2D_SAMPLES,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";
import type { AvatarModelSummary } from "@/lib/avatar/indexed-db-avatar-model-store";
import type { Live2DModelBindings } from "@/lib/avatar/live2d-avatar-provider";
import {
  createLive2DBindingBackup,
  parseLive2DBindingBackup,
} from "@/lib/avatar/binding-backup";
import {
  live2DModelBindings,
  live2DSourceKey,
} from "@/lib/avatar/model-bindings";
import type { KanaPreferences } from "@/lib/preferences/types";
import { SUPPORTED_SUBTITLE_LANGUAGES } from "@/lib/presentation/languages";
import type { Emotion } from "@/lib/presentation/types";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import type { VoiceDescriptor } from "@/lib/voice/types";
import type { CreateVoiceCloneInput } from "@/lib/voice/qwen3-tts-contract";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { HermesControlPanel } from "./hermes-control-panel";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { KANA_DEVELOPMENT_MODE } from "@/lib/config/features";

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
  onPreviewAvatarEmotion(
    preferences: KanaPreferences,
    emotion: Emotion,
  ): Promise<void>;
  onPreviewAvatarMotion(
    preferences: KanaPreferences,
    motion: string,
  ): Promise<void>;
  onPreviewAvatarTalking(preferences: KanaPreferences): Promise<void>;
  onInspectVoice(baseUrl: string): Promise<VoiceProviderStatus>;
  onCloneVoice(
    baseUrl: string,
    input: CreateVoiceCloneInput,
  ): Promise<VoiceDescriptor>;
  onDeleteClonedVoice(
    baseUrl: string,
    voiceId: string,
  ): Promise<VoiceProviderStatus>;
  onInspectHermesControl(): Promise<HermesRuntimeStatus>;
  onStartHermesControl(options: {
    port: number;
    token: string;
    cwd?: string;
    restart?: boolean;
  }): Promise<HermesRuntimeStatus>;
  onStopHermesControl(): Promise<HermesRuntimeStatus>;
  onPrepareHermesCommand(command: string): void;
  onReplayVoice(): Promise<void>;
  onStopVoice(): void;
  onExportBackup(): string;
  onImportBackup(text: string): Promise<{
    importedConversations: number;
    totalConversations: number;
  }>;
  onClose(): void;
};

const EMOTION_BINDINGS: Array<{ emotion: Emotion; label: string }> = [
  { emotion: "neutral", label: "Neutral" },
  { emotion: "happy", label: "Happy" },
  { emotion: "sad", label: "Sad" },
  { emotion: "angry", label: "Angry" },
  { emotion: "surprised", label: "Surprised" },
  { emotion: "thinking", label: "Thinking" },
  { emotion: "confused", label: "Confused" },
  { emotion: "excited", label: "Excited" },
];

const MOTION_BINDINGS = [
  ["affirm", "Affirm"],
  ["surprise", "Surprise"],
  ["think", "Think"],
  ["tilt", "Tilt"],
  ["celebrate", "Celebrate"],
] as const;

function motionValue(motion?: { group: string; index?: number }): string {
  if (!motion) return "";
  return motion.index === undefined ? motion.group : `${motion.group}:${motion.index}`;
}

function parseMotion(value: string): { group: string; index?: number } | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(.*?)(?::(\d+))?$/.exec(normalized);
  const group = match?.[1]?.trim();
  if (!group) return null;
  const index = match?.[2] === undefined ? undefined : Number(match[2]);
  return { group, ...(index === undefined ? {} : { index }) };
}

export function SettingsDialog({
  preferences,
  diagnostics,
  voiceRuntimeState,
  voiceCanReplay,
  onSave,
  onImportAvatar,
  onListAvatarModels,
  onSelectAvatarModel,
  onRenameAvatarModel,
  onDeleteAvatarModel,
  onPreviewAvatarEmotion,
  onPreviewAvatarMotion,
  onPreviewAvatarTalking,
  onInspectVoice,
  onCloneVoice,
  onDeleteClonedVoice,
  onInspectHermesControl,
  onStartHermesControl,
  onStopHermesControl,
  onPrepareHermesCommand,
  onReplayVoice,
  onStopVoice,
  onExportBackup,
  onImportBackup,
  onClose,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(preferences);
  const [importingAvatar, setImportingAvatar] = useState(false);
  const [avatarImportNotice, setAvatarImportNotice] = useState<string | null>(null);
  const [avatarModels, setAvatarModels] = useState<AvatarModelSummary[]>([]);
  const [avatarLibraryLoading, setAvatarLibraryLoading] = useState(true);
  const [checkingVoice, setCheckingVoice] = useState(false);
  const [voiceInspection, setVoiceInspection] =
    useState<VoiceProviderStatus | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudio, setCloneAudio] = useState<File | null>(null);
  const [cloneReferenceText, setCloneReferenceText] = useState("");
  const [cloneXVectorOnly, setCloneXVectorOnly] = useState(false);
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloningVoice, setCloningVoice] = useState(false);
  const [voiceCloneNotice, setVoiceCloneNotice] = useState<string | null>(null);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null);
  const [previewEmotion, setPreviewEmotion] = useState<Emotion>("happy");
  const [previewMotion, setPreviewMotion] = useState("affirm");
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onClose);

  const refreshAvatarModels = () => {
    setAvatarLibraryLoading(true);
    void onListAvatarModels()
      .then(setAvatarModels)
      .catch((error) =>
        setAvatarImportNotice(
          error instanceof Error
            ? error.message
            : "Could not read the local avatar library.",
        ),
      )
      .finally(() => setAvatarLibraryLoading(false));
  };

  useEffect(() => {
    let active = true;
    void onListAvatarModels()
      .then((models) => {
        if (active) setAvatarModels(models);
      })
      .catch((error) => {
        if (active) {
          setAvatarImportNotice(
            error instanceof Error
              ? error.message
              : "Could not read the local avatar library.",
          );
        }
      })
      .finally(() => {
        if (active) setAvatarLibraryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onListAvatarModels]);

  const currentBindingKey = live2DSourceKey(draft.live2d);
  const currentBindings = live2DModelBindings(draft.live2d);
  const updateCurrentBindings = (bindings: Live2DModelBindings) => {
    setDraft((current) => ({
      ...current,
      live2d: {
        ...current.live2d,
        mouthOpenParameter: bindings.mouthOpenParameter,
        bindingProfiles: {
          ...current.live2d.bindingProfiles,
          [live2DSourceKey(current.live2d)]: bindings,
        },
      },
    }));
  };
  const selectOfficialSample = (
    sample: (typeof OFFICIAL_LIVE2D_SAMPLES)[number],
  ) => {
    setDraft((current) => {
      const selected = {
        ...current.live2d,
        modelUrl: sample.modelUrl,
        modelId: undefined,
        modelName: sample.name,
        mouthOpenParameter: sample.bindings.mouthOpenParameter,
      };
      return {
        ...current,
        avatarMode: "live2d",
        live2d: {
          ...selected,
          bindingProfiles: {
            ...selected.bindingProfiles,
            [live2DSourceKey(selected)]: {
              ...sample.bindings,
              emotionExpressions: { ...sample.bindings.emotionExpressions },
              motions: { ...sample.bindings.motions },
            },
          },
        },
      };
    });
    setAvatarImportNotice(
      `${sample.name} selected. Save preferences to load this official sample.`,
    );
  };
  const saveHostedModel = () => {
    try {
      const url = normalizeLive2DModelUrl(draft.live2d.modelUrl);
      const existing = draft.live2d.hostedModels?.find((model) => model.url === url);
      if (existing) {
        setAvatarImportNotice(`${existing.name} is already in the hosted library.`);
        return;
      }
      const pathName = new URL(url).pathname.split("/").at(-1) ?? "Live2D model";
      const name = pathName.replace(/\.model3\.json$/i, "") || "Live2D model";
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `hosted-${crypto.randomUUID()}`
          : `hosted-${Date.now().toString(36)}`;
      setDraft((current) => ({
        ...current,
        live2d: {
          ...current.live2d,
          modelUrl: url,
          modelId: undefined,
          modelName: name,
          hostedModels: [
            ...(current.live2d.hostedModels ?? []),
            { id, name, url, addedAt: Date.now() },
          ],
        },
      }));
      setAvatarImportNotice(`${name} was added. Save preferences to keep it.`);
    } catch (error) {
      setAvatarImportNotice(
        error instanceof Error ? error.message : "The hosted model URL is invalid.",
      );
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="panel-heading">
          <div>
            <h2 id="settings-title">Kana settings</h2>
            <p>Local preferences for this device</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings-content">
          <fieldset>
            <legend>Subtitles</legend>
            <label>
              Language for future replies
              <select
                value={draft.subtitleLanguage}
                onChange={(event) =>
                  setDraft({ ...draft, subtitleLanguage: event.target.value })
                }
              >
                {SUPPORTED_SUBTITLE_LANGUAGES.map((language) => (
                  <option value={language.code} key={language.code}>
                    {language.nativeLabel}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              Existing messages keep the exact subtitle text and language you originally saw.
            </p>
          </fieldset>

          <fieldset>
            <legend>Agent connection</legend>
            {KANA_DEVELOPMENT_MODE ? <div className="segmented-control" aria-label="Agent mode">
              <button
                className={draft.agentMode === "mock" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, agentMode: "mock" })}
                type="button"
              >
                Mock
              </button>
              <button
                className={draft.agentMode === "hermes" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, agentMode: "hermes" })}
                type="button"
              >
                Hermes
              </button>
            </div> : null}
            {draft.agentMode === "hermes" ? (
              <div className="settings-grid">
                <label>
                  Hermes WebSocket URL
                  <input
                    value={draft.hermes.websocketUrl}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hermes: { ...draft.hermes, websocketUrl: event.target.value },
                      })
                    }
                    placeholder="ws://127.0.0.1:9119/api/ws"
                  />
                </label>
                <label>
                  Session token
                  <input
                    type="password"
                    value={draft.hermes.token}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hermes: { ...draft.hermes, token: event.target.value },
                      })
                    }
                    autoComplete="off"
                  />
                  <span className="field-hint">
                    Kept only for this browser tab; never written to persistent
                    local storage.
                  </span>
                </label>
                <label>
                  Working folder <span>(optional)</span>
                  <input
                    value={draft.hermes.cwd}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hermes: { ...draft.hermes, cwd: event.target.value },
                      })
                    }
                    placeholder="/path/to/project"
                  />
                </label>
                <p className="field-hint full-width">
                  Kana connects to the official <code>hermes serve</code> gateway. Hermes stays the only agent.
                </p>
                <HermesControlPanel
                  websocketUrl={draft.hermes.websocketUrl}
                  token={draft.hermes.token}
                  cwd={draft.hermes.cwd}
                  onConnectionChange={({ websocketUrl, token }) =>
                    setDraft((current) => ({
                      ...current,
                      hermes: { ...current.hermes, websocketUrl, token },
                    }))
                  }
                  onInspect={onInspectHermesControl}
                  onStart={onStartHermesControl}
                  onStop={onStopHermesControl}
                  onPrepareCommand={onPrepareHermesCommand}
                />
              </div>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Avatar</legend>
            {KANA_DEVELOPMENT_MODE ? <div className="segmented-control" aria-label="Avatar provider">
              <button
                className={draft.avatarMode === "mock" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, avatarMode: "mock" })}
                type="button"
              >
                CSS preview
              </button>
              <button
                className={draft.avatarMode === "live2d" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, avatarMode: "live2d" })}
                type="button"
              >
                Live2D
              </button>
            </div> : null}
            {draft.avatarMode === "live2d" ? (
              <div className="settings-grid">
                <div className="official-avatar-samples full-width">
                  <span className="settings-field-label">Official free samples</span>
                  <div className="avatar-library-list official">
                    {OFFICIAL_LIVE2D_SAMPLES.map((sample) => {
                      const active =
                        !draft.live2d.modelId &&
                        draft.live2d.modelUrl === sample.modelUrl;
                      return (
                        <article className={active ? "active" : ""} key={sample.id}>
                          <div>
                            <strong>{sample.name}</strong>
                            <small>
                              Live2D original sample · mouth {sample.bindings.mouthOpenParameter}
                            </small>
                          </div>
                          <div className="avatar-library-actions">
                            <button
                              aria-label={`Use ${sample.name} official sample`}
                              className="secondary-button"
                              disabled={active}
                              type="button"
                              onClick={() => selectOfficialSample(sample)}
                            >
                              {active ? "Active" : "Use"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                <label className="full-width">
                  Model settings URL
                  <input
                    value={draft.live2d.modelUrl}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        live2d: {
                          ...draft.live2d,
                          modelUrl: event.target.value,
                          modelId: undefined,
                          modelName: undefined,
                        },
                      })
                    }
                    placeholder="https://example.com/avatar/Avatar.model3.json"
                  />
                </label>
                <div className="hosted-model-save full-width">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={saveHostedModel}
                  >
                    Save URL to avatar library
                  </button>
                  <span className="field-hint">
                    Saves the URL and bindings only; remote model assets are not copied.
                  </span>
                </div>
                <label>
                  Mouth parameter
                  <input
                    value={currentBindings.mouthOpenParameter}
                    onChange={(event) =>
                      updateCurrentBindings({
                        ...currentBindings,
                        mouthOpenParameter: event.target.value,
                      })
                    }
                    placeholder="ParamMouthOpenY"
                  />
                </label>
                <label className="full-width">
                  Official Cubism Core URL
                  <input
                    value={draft.live2d.coreScriptUrl}
                    readOnly
                  />
                  <span className="field-hint">
                    Executable Core code is restricted to Live2D&apos;s official SDK host.
                  </span>
                </label>
                <label className="avatar-folder-import full-width">
                  Import a model folder
                  <input
                    disabled={importingAvatar}
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      if (!files.length) return;
                      setImportingAvatar(true);
                      setAvatarImportNotice(null);
                      void onImportAvatar(files)
                        .then((model) => {
                          setDraft((current) => ({
                            ...current,
                            avatarMode: "live2d",
                            live2d: {
                              ...current.live2d,
                              modelId: model.id,
                              modelName: model.name,
                            },
                          }));
                          setAvatarImportNotice(
                            `${model.name} was imported and will remain available after reload.`,
                          );
                          refreshAvatarModels();
                        })
                        .catch((error) =>
                          setAvatarImportNotice(
                            error instanceof Error
                              ? error.message
                              : "Could not import the Live2D folder.",
                          ),
                        )
                        .finally(() => setImportingAvatar(false));
                    }}
                    type="file"
                    {...({ directory: "", webkitdirectory: "" } as Record<
                      string,
                      string
                    >)}
                  />
                </label>
                {avatarImportNotice ? (
                  <p className="field-hint full-width" role="status">
                    {avatarImportNotice}
                  </p>
                ) : null}
                {draft.live2d.modelId ? (
                  <p className="field-hint full-width" role="status">
                    Using saved model: {draft.live2d.modelName || "Imported Live2D model"}.
                    Edit the model URL above to switch back to a hosted model.
                  </p>
                ) : null}
                <details className="avatar-library full-width">
                  <summary>
                    Avatar model library ({
                      avatarModels.length + (draft.live2d.hostedModels?.length ?? 0)
                    })
                  </summary>
                  {(draft.live2d.hostedModels?.length ?? 0) > 0 ? (
                    <div className="avatar-library-list hosted">
                      {draft.live2d.hostedModels?.map((model) => {
                        const active = !draft.live2d.modelId && draft.live2d.modelUrl === model.url;
                        return (
                          <article className={active ? "active" : ""} key={model.id}>
                            <div>
                              <strong>{model.name}</strong>
                              <small>{model.url}</small>
                            </div>
                            <div className="avatar-library-actions">
                              <button
                                className="secondary-button"
                                disabled={active}
                                type="button"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    avatarMode: "live2d",
                                    live2d: {
                                      ...current.live2d,
                                      modelUrl: model.url,
                                      modelId: undefined,
                                      modelName: model.name,
                                    },
                                  }))
                                }
                              >
                                {active ? "Active" : "Use"}
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => {
                                  const name = window.prompt("Hosted avatar name", model.name);
                                  if (!name?.trim()) return;
                                  setDraft((current) => ({
                                    ...current,
                                    live2d: {
                                      ...current.live2d,
                                      modelName: active ? name.trim() : current.live2d.modelName,
                                      hostedModels: current.live2d.hostedModels?.map((item) =>
                                        item.id === model.id ? { ...item, name: name.trim() } : item,
                                      ),
                                    },
                                  }));
                                }}
                              >
                                Rename
                              </button>
                              <button
                                className="secondary-button danger"
                                disabled={active}
                                type="button"
                                onClick={() => {
                                  if (!window.confirm(`Remove ${model.name} from the URL library?`)) return;
                                  setDraft((current) => ({
                                    ...current,
                                    live2d: {
                                      ...current.live2d,
                                      hostedModels: current.live2d.hostedModels?.filter(
                                        (item) => item.id !== model.id,
                                      ),
                                    },
                                  }));
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                  {avatarLibraryLoading ? (
                    <p className="field-hint">Reading local models…</p>
                  ) : avatarModels.length ? (
                    <div className="avatar-library-list">
                      {avatarModels.map((model) => {
                        const active = draft.live2d.modelId === model.id;
                        return (
                          <article className={active ? "active" : ""} key={model.id}>
                            <div>
                              <strong>{model.name}</strong>
                              <small>
                                {(model.sizeBytes / 1024 ** 2).toFixed(1)} MB ·{" "}
                                {model.modelSettingsPath}
                              </small>
                            </div>
                            <div className="avatar-library-actions">
                              <button
                                className="secondary-button"
                                disabled={active}
                                type="button"
                                onClick={() => {
                                  setAvatarImportNotice(null);
                                  void onSelectAvatarModel(model.id)
                                    .then((selected) => {
                                      setDraft((current) => ({
                                        ...current,
                                        avatarMode: "live2d",
                                        live2d: {
                                          ...current.live2d,
                                          modelId: selected.id,
                                          modelName: selected.name,
                                        },
                                      }));
                                      setAvatarImportNotice(
                                        `${selected.name} is now active.`,
                                      );
                                    })
                                    .catch((error) =>
                                      setAvatarImportNotice(
                                        error instanceof Error
                                          ? error.message
                                          : "Could not load the selected avatar.",
                                      ),
                                    );
                                }}
                              >
                                {active ? "Active" : "Use"}
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => {
                                  const name = window.prompt(
                                    "Local avatar name",
                                    model.name,
                                  );
                                  if (!name?.trim()) return;
                                  void onRenameAvatarModel(model.id, name)
                                    .then((renamed) => {
                                      setAvatarModels((current) =>
                                        current.map((item) =>
                                          item.id === renamed.id ? renamed : item,
                                        ),
                                      );
                                      if (active) {
                                        setDraft((current) => ({
                                          ...current,
                                          live2d: {
                                            ...current.live2d,
                                            modelName: renamed.name,
                                          },
                                        }));
                                      }
                                    })
                                    .catch((error) =>
                                      setAvatarImportNotice(
                                        error instanceof Error
                                          ? error.message
                                          : "Could not rename the avatar.",
                                      ),
                                    );
                                }}
                              >
                                Rename
                              </button>
                              <button
                                className="secondary-button danger"
                                disabled={active}
                                type="button"
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Delete ${model.name} from this browser?`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void onDeleteAvatarModel(model.id)
                                    .then(refreshAvatarModels)
                                    .catch((error) =>
                                      setAvatarImportNotice(
                                        error instanceof Error
                                          ? error.message
                                          : "Could not delete the avatar.",
                                      ),
                                    );
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="field-hint">
                      No local model folders have been imported yet.
                    </p>
                  )}
                </details>
                <details className="avatar-bindings full-width">
                  <summary>Per-model expression and motion bindings</summary>
                  <p className="field-hint">
                    Saved for this model only ({currentBindingKey.startsWith("import:")
                      ? "imported folder"
                      : "model URL"}). Leave an unsupported binding empty.
                  </p>
                  <div className="avatar-binding-grid">
                    {EMOTION_BINDINGS.map(({ emotion, label }) => (
                      <label key={emotion}>
                        {label} expression
                        <input
                          value={currentBindings.emotionExpressions?.[emotion] ?? ""}
                          onChange={(event) => {
                            const emotionExpressions = {
                              ...currentBindings.emotionExpressions,
                            };
                            const value = event.target.value.trim();
                            if (value) emotionExpressions[emotion] = value;
                            else delete emotionExpressions[emotion];
                            updateCurrentBindings({
                              ...currentBindings,
                              emotionExpressions,
                            });
                          }}
                          placeholder="Expression ID"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="avatar-binding-grid motion-bindings">
                    {MOTION_BINDINGS.map(([name, label]) => (
                      <label key={name}>
                        {label} motion
                        <input
                          value={motionValue(currentBindings.motions?.[name])}
                          onChange={(event) => {
                            const motions = { ...currentBindings.motions };
                            const motion = parseMotion(event.target.value);
                            if (motion) motions[name] = motion;
                            else delete motions[name];
                            updateCurrentBindings({ ...currentBindings, motions });
                          }}
                          placeholder="Group or Group:0"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="binding-file-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        const backup = createLive2DBindingBackup(
                          draft.live2d.modelName || draft.live2d.modelUrl,
                          currentBindings,
                        );
                        const blob = new Blob([JSON.stringify(backup, null, 2)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "kana-live2d-bindings.json";
                        anchor.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export bindings
                    </button>
                    <label className="secondary-button backup-file-button">
                      Import bindings
                      <input
                        accept="application/json,.json"
                        type="file"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (!file) return;
                          void file.text().then((text) => {
                            const backup = parseLive2DBindingBackup(text);
                            updateCurrentBindings(backup.bindings);
                            setAvatarImportNotice(
                              `Bindings imported${backup.sourceLabel ? ` from ${backup.sourceLabel}` : ""}. Save preferences to keep them.`,
                            );
                          }).catch((error) =>
                            setAvatarImportNotice(
                              error instanceof Error
                                ? error.message
                                : "Could not import Live2D bindings.",
                            ),
                          );
                        }}
                      />
                    </label>
                  </div>
                </details>
                <div className="avatar-preview-controls full-width">
                  <label>
                    Test emotion
                    <select
                      value={previewEmotion}
                      onChange={(event) =>
                        setPreviewEmotion(event.target.value as Emotion)
                      }
                    >
                      {EMOTION_BINDINGS.map(({ emotion, label }) => (
                        <option key={emotion} value={emotion}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void onPreviewAvatarEmotion(draft, previewEmotion)}
                  >
                    Preview emotion
                  </button>
                  <label>
                    Test motion
                    <select
                      value={previewMotion}
                      onChange={(event) => setPreviewMotion(event.target.value)}
                    >
                      {MOTION_BINDINGS.map(([name, label]) => (
                        <option key={name} value={name}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void onPreviewAvatarMotion(draft, previewMotion)}
                  >
                    Preview motion
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void onPreviewAvatarTalking(draft)}
                  >
                    Preview talking
                  </button>
                </div>
                <p className="field-hint full-width">
                  Choose a folder containing one <code>.model3.json</code> file
                  and every referenced <code>.moc3</code>, texture, physics,
                  expression, and motion file. Imported assets stay local in
                  this browser and persist across reloads.
                </p>
                <p className="live2d-credit full-width">
                  Haru and Mao are loaded from Live2D&apos;s official sample
                  collection and are not copied into Kana. {LIVE2D_SAMPLE_COPYRIGHT_NOTICE}{" "}
                  <a
                    href="https://www.live2d.com/en/learn/sample/model-terms/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Sample terms
                  </a>
                </p>
              </div>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Japanese voice</legend>
            <label className="toggle-row">
              <span>
                Play speech
                <small>Always uses speech_ja as Japanese input</small>
              </span>
              <input
                type="checkbox"
                checked={draft.voiceEnabled}
                onChange={(event) =>
                  setDraft({ ...draft, voiceEnabled: event.target.checked })
                }
              />
            </label>
            {KANA_DEVELOPMENT_MODE ? <div className="segmented-control" aria-label="Voice provider">
              <button
                className={draft.voiceMode === "mock" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, voiceMode: "mock" })}
                type="button"
              >
                Mock lip sync
              </button>
              <button
                className={draft.voiceMode === "qwen3" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, voiceMode: "qwen3" })}
                type="button"
              >
                Qwen3-TTS
              </button>
            </div> : null}
            <div className="voice-playback-controls">
              <span className={`voice-lifecycle ${voiceRuntimeState}`} role="status">
                {voiceRuntimeState.replaceAll("_", " ")}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={!voiceCanReplay}
                onClick={() => void onReplayVoice()}
              >
                Replay last speech
              </button>
              {[
                "synthesizing",
                "playing",
                "stopping",
              ].includes(voiceRuntimeState) ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onStopVoice}
                >
                  Stop voice
                </button>
              ) : null}
            </div>
            {draft.voiceMode === "qwen3" ? (
              <div className="settings-grid">
                <label>
                  Local TTS service URL
                  <input
                    value={draft.qwen3Tts.baseUrl}
                    onChange={(event) => {
                      setVoiceInspection(null);
                      setDraft({
                        ...draft,
                        qwen3Tts: {
                          ...draft.qwen3Tts,
                          baseUrl: event.target.value,
                        },
                      });
                    }}
                    placeholder="http://127.0.0.1:7860"
                  />
                </label>
                <label>
                  Voice or cloned profile
                  <input
                    list="qwen3-voice-options"
                    value={draft.qwen3Tts.voiceId}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        qwen3Tts: { ...draft.qwen3Tts, voiceId: event.target.value },
                      })
                    }
                  />
                  <datalist id="qwen3-voice-options">
                    {voiceInspection?.voices.map((voice) => (
                      <option value={voice.id} key={voice.id}>
                        {voice.name ?? voice.id}
                      </option>
                    ))}
                  </datalist>
                </label>
                {voiceInspection?.supportsVoiceClone ? (
                  <section className="voice-clone-panel full-width" aria-labelledby="voice-clone-title">
                    <div className="settings-subheading">
                      <div>
                        <strong id="voice-clone-title">Clone a voice locally</strong>
                        <small>
                          The reference recording stays in the local Qwen service data folder.
                        </small>
                      </div>
                      <span className="local-badge">Local only</span>
                    </div>
                    <div className="settings-grid voice-clone-grid">
                      <label>
                        Profile name
                        <input
                          value={cloneName}
                          maxLength={80}
                          onChange={(event) => setCloneName(event.target.value)}
                          placeholder="My Kana voice"
                        />
                      </label>
                      <label>
                        Reference audio
                        <input
                          type="file"
                          accept="audio/wav,audio/x-wav,audio/flac,audio/ogg,.wav,.flac,.ogg"
                          onChange={(event) =>
                            setCloneAudio(event.target.files?.[0] ?? null)
                          }
                        />
                        <small>Use a clear 3–15 second WAV, FLAC, or OGG recording.</small>
                      </label>
                      <label className="full-width">
                        Exact reference transcript
                        <textarea
                          value={cloneReferenceText}
                          maxLength={2000}
                          disabled={cloneXVectorOnly}
                          onChange={(event) => setCloneReferenceText(event.target.value)}
                          placeholder="Write exactly what is spoken in the reference audio"
                        />
                      </label>
                    </div>
                    <label className="toggle-row compact-toggle">
                      <span>
                        Use speaker embedding only
                        <small>Allows no transcript, but usually reduces voice similarity.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={cloneXVectorOnly}
                        onChange={(event) => setCloneXVectorOnly(event.target.checked)}
                      />
                    </label>
                    <label className="consent-row">
                      <input
                        type="checkbox"
                        checked={cloneConsent}
                        onChange={(event) => setCloneConsent(event.target.checked)}
                      />
                      <span>
                        I own this voice or have explicit permission to clone and use it.
                      </span>
                    </label>
                    <div className="settings-actions inline-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          cloningVoice ||
                          !cloneAudio ||
                          !cloneName.trim() ||
                          (!cloneXVectorOnly && !cloneReferenceText.trim()) ||
                          !cloneConsent
                        }
                        onClick={() => {
                          if (!cloneAudio) return;
                          setCloningVoice(true);
                          setVoiceCloneNotice("Creating a reusable voice profile…");
                          void onCloneVoice(draft.qwen3Tts.baseUrl, {
                            name: cloneName,
                            audio: cloneAudio,
                            referenceText: cloneReferenceText,
                            xVectorOnly: cloneXVectorOnly,
                            consent: cloneConsent,
                          })
                            .then(async (voice) => {
                              const inspection = await onInspectVoice(
                                draft.qwen3Tts.baseUrl,
                              );
                              setVoiceInspection(inspection);
                              setDraft((current) => ({
                                ...current,
                                qwen3Tts: { ...current.qwen3Tts, voiceId: voice.id },
                              }));
                              setVoiceCloneNotice(
                                `${voice.name ?? cloneName} is ready and selected. Save preferences to use it.`,
                              );
                              setCloneName("");
                              setCloneAudio(null);
                              setCloneReferenceText("");
                              setCloneConsent(false);
                            })
                            .catch((error) =>
                              setVoiceCloneNotice(
                                error instanceof Error
                                  ? error.message
                                  : "Could not create the cloned voice.",
                              ),
                            )
                            .finally(() => setCloningVoice(false));
                        }}
                      >
                        {cloningVoice ? "Cloning…" : "Create cloned voice"}
                      </button>
                    </div>
                    {voiceInspection.voices.some((voice) => voice.kind === "cloned") ? (
                      <div className="cloned-voice-list">
                        {voiceInspection.voices
                          .filter((voice) => voice.kind === "cloned")
                          .map((voice) => (
                            <div className="cloned-voice-row" key={voice.id}>
                              <span>
                                <strong>{voice.name ?? voice.id}</strong>
                                <small>{voice.xVectorOnly ? "Embedding only" : "Transcript-guided clone"}</small>
                              </span>
                              <button
                                type="button"
                                className="text-button danger-text"
                                onClick={() => {
                                  if (!window.confirm(`Delete cloned voice “${voice.name ?? voice.id}”?`)) return;
                                  void onDeleteClonedVoice(
                                    draft.qwen3Tts.baseUrl,
                                    voice.id,
                                  )
                                    .then((inspection) => {
                                      setVoiceInspection(inspection);
                                      if (draft.qwen3Tts.voiceId === voice.id) {
                                        setDraft((current) => ({
                                          ...current,
                                          qwen3Tts: {
                                            ...current.qwen3Tts,
                                            voiceId: inspection.defaultVoiceId ?? "",
                                          },
                                        }));
                                      }
                                      setVoiceCloneNotice("Cloned voice deleted.");
                                    })
                                    .catch((error) =>
                                      setVoiceCloneNotice(
                                        error instanceof Error
                                          ? error.message
                                          : "Could not delete the cloned voice.",
                                      ),
                                    );
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : null}
                    {voiceCloneNotice ? <p className="field-hint">{voiceCloneNotice}</p> : null}
                  </section>
                ) : voiceInspection?.state === "ready" ? (
                  <p className="field-hint full-width">
                    This service uses a {voiceInspection.modelType ?? "non-Base"} model.
                    Start the Qwen3-TTS Base checkpoint to enable voice cloning.
                  </p>
                ) : null}
                <label>
                  Speech delivery
                  <select
                    value={draft.qwen3Tts.deliveryMode}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        qwen3Tts: {
                          ...draft.qwen3Tts,
                          deliveryMode:
                            event.target.value === "sentence_chunks"
                              ? "sentence_chunks"
                              : "complete",
                        },
                      })
                    }
                  >
                    <option value="complete">Complete response</option>
                    <option value="sentence_chunks">
                      Sentence chunks (experimental)
                    </option>
                  </select>
                  <small>
                    Complete response has the smoothest prosody. Sentence chunks
                    can start sooner on slow hardware, while keeping one Hermes
                    response and ordered cancellation.
                  </small>
                </label>
                <div className="voice-service-check full-width">
                  <button
                    className="secondary-button"
                    disabled={checkingVoice}
                    onClick={() => {
                      setCheckingVoice(true);
                      setVoiceInspection(null);
                      void onInspectVoice(draft.qwen3Tts.baseUrl)
                        .then((inspection) => {
                          setVoiceInspection(inspection);
                          if (
                            inspection.state === "ready" &&
                            !draft.qwen3Tts.voiceId &&
                            inspection.defaultVoiceId
                          ) {
                            setDraft((current) => ({
                              ...current,
                              qwen3Tts: {
                                ...current.qwen3Tts,
                                voiceId: inspection.defaultVoiceId ?? "",
                              },
                            }));
                          }
                        })
                        .finally(() => setCheckingVoice(false));
                    }}
                    type="button"
                  >
                    {checkingVoice ? "Checking…" : "Check service"}
                  </button>
                  {voiceInspection ? (
                    <div
                      className={`voice-service-status ${voiceInspection.state}`}
                      role="status"
                    >
                      <span />
                      <div>
                        <strong>
                          {voiceInspection.state === "ready"
                            ? "Qwen3-TTS ready"
                            : voiceInspection.state === "loading"
                              ? "Model loading"
                              : "Service unavailable"}
                        </strong>
                        <small>{voiceInspection.message}</small>
                        {voiceInspection.model ? (
                          <small>
                            {voiceInspection.model} · {voiceInspection.device}
                            {voiceInspection.supportsInstruction === false
                              ? " · fixed voice style"
                              : " · emotion instructions"}
                          </small>
                        ) : null}
                        {voiceInspection.setup ? (
                          <small>
                            {(
                              voiceInspection.setup.freeDiskBytes /
                              1024 ** 3
                            ).toFixed(1)}{" "}
                            GB free · model cache{" "}
                            {voiceInspection.setup.modelCacheDetected
                              ? "detected"
                              : "not detected"}
                            {voiceInspection.setup.diskSufficient
                              ? ""
                              : " · less than 4 GB available"}
                          </small>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="field-hint">
                      Uses Kana Qwen3-TTS API v1. The first model load can take
                      several minutes on CPU.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Diagnostics</legend>
            <p className="field-hint diagnostics-intro">
              Safe local status for troubleshooting. It excludes the Hermes
              token, protected input, prompts, conversation text, and tool
              contents.
            </p>
            <div className="diagnostics-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDiagnosticsNotice(null);
                  void navigator.clipboard.writeText(diagnostics).then(
                    () => setDiagnosticsNotice("Diagnostics copied."),
                    () =>
                      setDiagnosticsNotice(
                        "Clipboard access was denied. Select the preview and copy it manually.",
                      ),
                  );
                }}
              >
                Copy diagnostics
              </button>
              {diagnosticsNotice ? (
                <span className="field-hint" role="status">
                  {diagnosticsNotice}
                </span>
              ) : null}
            </div>
            <details className="diagnostics-preview">
              <summary>Preview safe diagnostics</summary>
              <pre>{diagnostics}</pre>
            </details>
          </fieldset>

          <fieldset>
            <legend>Help and local services</legend>
            <div className="help-grid">
              <section>
                <strong>Mock mode</strong>
                <p>
                  Works without Hermes, Qwen, internet, or WebGL. It is for UI
                  development and does not run real agent tools.
                </p>
              </section>
              <section>
                <strong>Hermes mode</strong>
                <p>
                  Start the unmodified <code>hermes serve</code> process on the
                  configured URL, then use the Hermes status button. Kana is
                  only its presentation layer.
                </p>
              </section>
              <section>
                <strong>Japanese voice</strong>
                <p>
                  Qwen3-TTS is a separate local service. Use Check service to
                  see model, cache, device, disk, and readiness before enabling it.
                </p>
              </section>
              <section>
                <strong>Local data</strong>
                <p>
                  History and imported avatars stay in this browser profile.
                  Clearing site data removes Kana data, never Hermes data.
                </p>
              </section>
            </div>
          </fieldset>

          <fieldset>
            <legend>Local data backup</legend>
            <p className="field-hint diagnostics-intro">
              Export conversations and non-secret preferences as JSON. Hermes
              tokens and imported Live2D files are excluded. Restore merges by
              conversation ID and never deletes unmatched history.
            </p>
            <div className="diagnostics-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const blob = new Blob([onExportBackup()], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `kana-backup-${new Date()
                    .toISOString()
                    .slice(0, 10)}.json`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                  setBackupNotice(
                    "Backup downloaded without credentials or avatar assets.",
                  );
                }}
              >
                Download backup
              </button>
              <label className="secondary-button backup-file-button">
                {restoringBackup ? "Restoring…" : "Restore backup"}
                <input
                  accept="application/json,.json"
                  disabled={restoringBackup}
                  type="file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    if (
                      !window.confirm(
                        "Merge this backup into Kana? Matching conversation IDs will be updated, and existing unmatched history will remain.",
                      )
                    ) {
                      return;
                    }
                    setRestoringBackup(true);
                    setBackupNotice(null);
                    void file
                      .text()
                      .then(onImportBackup)
                      .then((result) =>
                        setBackupNotice(
                          `Restored ${result.importedConversations} conversation(s); ${result.totalConversations} now stored locally.`,
                        ),
                      )
                      .catch((error) =>
                        setBackupNotice(
                          error instanceof Error
                            ? error.message
                            : "Could not restore the Kana backup.",
                        ),
                      )
                      .finally(() => setRestoringBackup(false));
                  }}
                />
              </label>
              {backupNotice ? (
                <span className="field-hint" role="status">
                  {backupNotice}
                </span>
              ) : null}
            </div>
          </fieldset>
        </div>

        <div className="settings-footer">
          {preferencesNotice ? (
            <span className="field-hint settings-save-notice" role="alert">
              {preferencesNotice}
            </span>
          ) : null}
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={savingPreferences}
            onClick={() => {
              setSavingPreferences(true);
              setPreferencesNotice(null);
              void onSave(draft)
                .then(onClose)
                .catch((error) => {
                  setPreferencesNotice(
                    error instanceof Error
                      ? error.message
                      : "Could not save preferences.",
                  );
                  setSavingPreferences(false);
                });
            }}
          >
            {savingPreferences ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </section>
    </div>
  );
}
