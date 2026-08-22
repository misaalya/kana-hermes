"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityPanel } from "./activity-panel";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { DialogueHistory } from "./dialogue-history";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { OnboardingDialog } from "./onboarding-dialog";
import { useKanaController } from "@/lib/state/use-kana-controller";
import { KANA_DEVELOPMENT_MODE } from "@/lib/config/features";

function destructiveCommandPrompt(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/^\/+/, "");
  if (normalized === "new" || normalized.startsWith("new ")) {
    return "Start a fresh Kana and Hermes conversation?";
  }
  if (normalized === "undo" || normalized.startsWith("undo ")) {
    return "Undo the latest Hermes turn and remove it from this Kana history?";
  }
  if (normalized === "restart" || normalized.startsWith("restart ")) {
    return "Restart the Hermes gateway? Kana will disconnect temporarily.";
  }
  if (normalized === "update" || normalized.startsWith("update ")) {
    return "Allow Hermes to update its own installation?";
  }
  if (/^rollback\s+(restore|rewind)\b/.test(normalized)) {
    return "Restore a Hermes filesystem checkpoint? This can overwrite current files.";
  }
  return null;
}

type KanaAppProps = {
  appVersion: string;
};

export function KanaApp({ appVersion }: KanaAppProps) {
  const kana = useKanaController(appVersion);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dialogueLogOpen, setDialogueLogOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const selectedCommandIndexRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { clearCommandSuggestions, completeCommands } = kana;
  const activeConversationId = kana.activeConversation?.id;
  const message = activeConversationId ? drafts[activeConversationId] ?? "" : "";
  const setMessage = (value: string) => {
    if (!activeConversationId) return;
    setDrafts((current) => ({ ...current, [activeConversationId]: value }));
  };

  const latestAssistant = useMemo(
    () =>
      kana.activeConversation?.messages
        .filter((item) => item.role === "assistant")
        .at(-1),
    [kana.activeConversation?.messages],
  );

  const commandName = /^\/([^\s/]+)/.exec(message.trim())?.[1]?.toLowerCase();
  const canSubmitWhileBusy = Boolean(
    commandName &&
      [
        "approve",
        "deny",
        "queue",
        "steer",
        "status",
        "agents",
        "goal",
        "heartbeat",
        "background",
      ].includes(commandName.replaceAll("_", "-")),
  );
  const connectionInTransition =
    kana.connectionState === "connecting" ||
    kana.connectionState === "reconnecting";
  const activeCommandIndex = Math.min(
    selectedCommandIndex,
    Math.max(0, kana.commandSuggestions.length - 1),
  );

  useEffect(() => {
    if (!message.startsWith("/")) {
      clearCommandSuggestions();
      return;
    }
    const timer = window.setTimeout(() => {
      void completeCommands(message);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [clearCommandSuggestions, completeCommands, message]);

  const highlightCommand = (index: number) => {
    selectedCommandIndexRef.current = index;
    setSelectedCommandIndex(index);
  };

  const selectCommand = (command: string) => {
    setMessage(`${command} `);
    kana.clearCommandSuggestions();
  };

  const submit = async () => {
    const text = message.trim();
    if (
      !text ||
      connectionInTransition ||
      (kana.busy && !canSubmitWhileBusy)
    ) {
      return;
    }
    const confirmation = destructiveCommandPrompt(text);
    if (confirmation && !window.confirm(confirmation)) return;
    setMessage("");
    const prefill = await kana.sendMessage(text);
    if (prefill) setMessage(prefill);
  };

  if (!kana.ready) {
    return (
      <main className="kana-loading">
        <div className="kana-mark">か</div>
        <p>Preparing Kana…</p>
      </main>
    );
  }

  return (
    <main className="kana-shell">
      <div
        className={historyOpen ? "mobile-sidebar open" : "mobile-sidebar"}
        aria-hidden={!historyOpen}
        inert={historyOpen ? undefined : true}
      >
        <ConversationSidebar
          conversations={kana.conversations}
          activeId={kana.activeConversation?.id}
          disabled={kana.busy}
          onCreate={() => {
            void kana.createConversation();
            setHistoryOpen(false);
          }}
          onSelect={(id) => {
            kana.selectConversation(id);
            setHistoryOpen(false);
          }}
          onRename={(id, title) => void kana.renameConversation(id, title)}
          onDelete={(id) => void kana.deleteConversation(id)}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
      {historyOpen ? (
        <button
          className="mobile-sidebar-backdrop"
          type="button"
          aria-label="Close conversation history"
          onClick={() => setHistoryOpen(false)}
        />
      ) : null}

      <div className="desktop-sidebar">
        <ConversationSidebar
          conversations={kana.conversations}
          activeId={kana.activeConversation?.id}
          disabled={kana.busy}
          onCreate={() => void kana.createConversation()}
          onSelect={kana.selectConversation}
          onRename={(id, title) => void kana.renameConversation(id, title)}
          onDelete={(id) => void kana.deleteConversation(id)}
        />
      </div>

      <section className="kana-workspace">
        <header className="workspace-header">
          <div className="header-start">
            <button
              className="icon-button mobile-only"
              onClick={() => setHistoryOpen(true)}
              aria-label="Open conversation history"
            >
              ☰
            </button>
            <div>
              <h2>{kana.activeConversation?.title || "Kana"}</h2>
              <p className="workspace-subtitle">Kana · Hermes interface</p>
            </div>
          </div>

          <div className="header-actions">
            <button
              className="header-button log-button"
              onClick={() => setDialogueLogOpen(true)}
              aria-label="Open dialogue log"
            >
              <span className="header-button-label">Log</span>
            </button>
            <button
              className={`connection-pill ${kana.connectionState}`}
              onClick={() =>
                void (kana.connectionState === "reconnecting"
                  ? kana.disconnectAgent()
                  : kana.connectAgent())
              }
              disabled={kana.busy || kana.connectionState === "connecting"}
              aria-label={
                kana.connectionState === "reconnecting"
                  ? "Cancel Hermes reconnect"
                  : `Connect ${kana.preferences.agentMode === "hermes" ? "Hermes" : "mock agent"}`
              }
              title={
                kana.connectionState === "reconnecting"
                  ? "Reconnecting — click to cancel"
                  : kana.connectionState.replaceAll("_", " ")
              }
            >
              <span />
              {KANA_DEVELOPMENT_MODE && kana.preferences.agentMode === "mock"
                ? "Mock"
                : "Hermes"}
            </button>
            <button
              className="header-button activity-button"
              onClick={() => setActivityOpen(!activityOpen)}
              aria-label="Open Hermes activity"
            >
              <span className="header-button-label">Activity</span>
              {kana.activities.some((item) => item.state === "running") ? (
                <span className="notification-dot" />
              ) : null}
            </button>
            <button
              className="header-button settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <span className="header-button-label">Settings</span>
            </button>
          </div>
        </header>

        {kana.error ? (
          <div className="error-banner" role="alert">
            <span>Something needs attention</span>
            <p>{kana.error}</p>
            <button onClick={kana.clearError} aria-label="Dismiss error">
              ×
            </button>
          </div>
        ) : null}

        <div className="workspace-content">
          <div className="conversation-canvas">
            <AvatarStage
              avatar={kana.avatar}
              latestAssistant={latestAssistant}
              status={kana.status}
              busy={kana.busy}
              onCanvasReady={kana.attachAvatarCanvas}
            />
            <div
              className={dialogueLogOpen ? "dialogue-log-overlay open" : "dialogue-log-overlay"}
              aria-hidden={!dialogueLogOpen}
              inert={dialogueLogOpen ? undefined : true}
            >
              <div className="dialogue-log-heading">
                <div>
                  <span>Conversation log</span>
                  <small>Stored subtitles remain exactly as shown</small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close dialogue log"
                  onClick={() => setDialogueLogOpen(false)}
                >
                  ×
                </button>
              </div>
              <DialogueHistory messages={kana.activeConversation?.messages ?? []} />
            </div>
          </div>

          <div className="composer-dock">
            <div className="composer-wrap">
            <SlashCommandMenu
              suggestions={kana.commandSuggestions}
              loading={kana.commandSuggestionsLoading}
              selectedIndex={activeCommandIndex}
              onHighlight={highlightCommand}
              onSelect={selectCommand}
            />
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="sr-only" htmlFor="kana-message">
                Message Kana
              </label>
              <textarea
                id="kana-message"
                ref={composerRef}
                value={message}
                aria-activedescendant={
                  kana.commandSuggestions.length
                    ? `kana-command-option-${activeCommandIndex}`
                    : undefined
                }
                aria-controls={
                  kana.commandSuggestions.length ? "kana-command-menu" : undefined
                }
                aria-autocomplete="list"
                onChange={(event) => {
                  highlightCommand(0);
                  setMessage(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ArrowDown" &&
                    kana.commandSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    highlightCommand(
                      (selectedCommandIndexRef.current + 1) %
                        kana.commandSuggestions.length,
                    );
                    return;
                  }
                  if (
                    event.key === "ArrowUp" &&
                    kana.commandSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    highlightCommand(
                      (selectedCommandIndexRef.current -
                        1 +
                        kana.commandSuggestions.length) %
                        kana.commandSuggestions.length,
                    );
                    return;
                  }
                  if (
                    (event.key === "Tab" || event.key === "Enter") &&
                    kana.commandSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    const selectedIndex = Math.min(
                      selectedCommandIndexRef.current,
                      kana.commandSuggestions.length - 1,
                    );
                    selectCommand(
                      kana.commandSuggestions[selectedIndex]?.text ??
                        kana.commandSuggestions[0].text,
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    kana.clearCommandSuggestions();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={
                  connectionInTransition
                    ? "Reconnecting to Hermes…"
                    : kana.busy
                    ? "Use /approve, /deny, /queue, or /steer…"
                    : "Talk to Kana, or type / for Hermes commands…"
                }
                rows={1}
              />
              <span className="composer-language">
                {kana.preferences.subtitleLanguage.toUpperCase()}
              </span>
              {kana.busy ? (
                <div className="busy-composer-actions">
                  {canSubmitWhileBusy ? (
                    <button className="send-button" type="submit">
                      Run
                    </button>
                  ) : null}
                  <button className="stop-button" type="button" onClick={() => void kana.abort()}>
                    <span /> Stop
                  </button>
                </div>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={!message.trim() || connectionInTransition}
                  aria-label="Send message"
                >
                  <span aria-hidden="true">↑</span>
                </button>
              )}
            </form>
          </div>
          <p className="composer-hint">Enter to send · Shift + Enter for a new line · / for Hermes commands</p>
          </div>
        </div>
      </section>

      {activityOpen ? (
        <ActivityPanel activities={kana.activities} onClose={() => setActivityOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          preferences={kana.preferences}
          diagnostics={kana.diagnostics}
          voiceRuntimeState={kana.voiceRuntimeState}
          voiceCanReplay={kana.voiceCanReplay}
          onSave={kana.savePreferences}
          onImportAvatar={kana.importAvatarFiles}
          onListAvatarModels={kana.listAvatarModels}
          onSelectAvatarModel={kana.selectAvatarModel}
          onRenameAvatarModel={kana.renameAvatarModel}
          onDeleteAvatarModel={kana.deleteAvatarModel}
          onPreviewAvatarEmotion={kana.previewAvatarEmotion}
          onPreviewAvatarMotion={kana.previewAvatarMotion}
          onPreviewAvatarTalking={kana.previewAvatarTalking}
          onInspectVoice={kana.inspectVoiceService}
          onCloneVoice={kana.cloneVoice}
          onDeleteClonedVoice={kana.deleteClonedVoice}
          onInspectHermesControl={kana.inspectHermesControl}
          onStartHermesControl={kana.startHermesControl}
          onStopHermesControl={kana.stopHermesControl}
          onPrepareHermesCommand={(command) => {
            setMessage(command);
            setSettingsOpen(false);
            window.setTimeout(() => composerRef.current?.focus(), 0);
          }}
          onReplayVoice={kana.replayVoice}
          onStopVoice={kana.stopVoice}
          onExportBackup={kana.exportLocalBackup}
          onImportBackup={kana.importLocalBackup}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {kana.pendingInput ? (
        <AgentInputDialog
          key={
            kana.pendingInput.kind === "approval"
              ? `approval-${kana.pendingInput.command}`
              : `${kana.pendingInput.kind}-${kana.pendingInput.requestId}`
          }
          request={kana.pendingInput}
          submitting={kana.respondingToInput}
          onRespond={kana.respondToInput}
        />
      ) : null}

      {!kana.preferences.onboardingCompleted ? (
        <OnboardingDialog
          preferences={kana.preferences}
          onTestAgent={kana.testAgentConnection}
          onComplete={kana.savePreferences}
        />
      ) : null}
    </main>
  );
}
