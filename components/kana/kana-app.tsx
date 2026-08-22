"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { DialogueHistory } from "./dialogue-history";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { OnboardingDialog } from "./onboarding-dialog";
import { useKanaController } from "@/lib/state/use-kana-controller";
import type { KanaMessage } from "@/lib/conversation/types";


function destructiveCommandPrompt(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/^\/+/, "");
  if (normalized === "new" || normalized.startsWith("new ")) return "Start a fresh Kana and Hermes conversation?";
  if (normalized === "undo" || normalized.startsWith("undo ")) return "Undo the latest Hermes turn and remove it from this Kana history?";
  if (normalized === "restart" || normalized.startsWith("restart ")) return "Restart the Hermes gateway? Kana will disconnect temporarily.";
  if (normalized === "update" || normalized.startsWith("update ")) return "Allow Hermes to update its own installation?";
  if (/^rollback\s+(restore|rewind)\b/.test(normalized)) return "Restore a Hermes filesystem checkpoint? This can overwrite current files.";
  return null;
}

const NO_MESSAGES: KanaMessage[] = [];

type KanaAppProps = { appVersion: string };

export function KanaApp({ appVersion }: KanaAppProps) {
  const kana = useKanaController(appVersion);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const selectedCommandIndexRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { clearCommandSuggestions, completeCommands } = kana;

  const activeConversationId = kana.activeConversation?.id;
  const message = activeConversationId ? drafts[activeConversationId] ?? "" : "";
  const setMessage = useCallback((value: string) => {
    setDrafts((current) => {
      if (!activeConversationId) return current;
      if (current[activeConversationId] === value) return current;
      return { ...current, [activeConversationId]: value };
    });
  }, [activeConversationId]);

  const latestAssistant = useMemo(
    () => kana.activeConversation?.messages.filter((item) => item.role === "assistant").at(-1),
    [kana.activeConversation?.messages],
  );

  const commandName = /^\/([^\s/]+)/.exec(message.trim())?.[1]?.toLowerCase();
  const canSubmitWhileBusy = Boolean(
    commandName && ["approve", "deny", "queue", "steer", "status", "agents", "goal", "heartbeat", "background"].includes(commandName.replaceAll("_", "-")),
  );
  const connectionInTransition = kana.connectionState === "connecting" || kana.connectionState === "reconnecting";
  const activeCommandIndex = Math.min(selectedCommandIndex, Math.max(0, kana.commandSuggestions.length - 1));
  const showGate = kana.ready && kana.preferences.agentMode === "hermes" && kana.connectionState === "disconnected";
  const hermesConfigKey = `${kana.preferences.hermes.websocketUrl}:${kana.preferences.hermes.token}`;
  const gateConnectAttemptsRef = useRef(0);

  // A reachable Hermes is normally auto-connected right away. When the gateway
  // is down, retrying on every gate appearance remounts the whole shell (and
  // the WebGL canvas) in a tight loop and starves the UI thread, so bound the
  // automatic attempts and leave further retries to the manual button.
  useEffect(() => {
    gateConnectAttemptsRef.current = 0;
  }, [hermesConfigKey]);

  useEffect(() => {
    if (!showGate) return;
    const attempt = gateConnectAttemptsRef.current;
    if (attempt >= 3) return;
    const delay = [300, 4_000, 15_000][attempt];
    const timer = setTimeout(() => {
      gateConnectAttemptsRef.current += 1;
      void kana.connectAgent();
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGate, hermesConfigKey]);

  useEffect(() => {
    if (!message.startsWith("/")) { clearCommandSuggestions(); return; }
    const timer = window.setTimeout(() => { void completeCommands(message); }, 120);
    return () => window.clearTimeout(timer);
  }, [clearCommandSuggestions, completeCommands, message]);

  const highlightCommand = useCallback((index: number) => {
    selectedCommandIndexRef.current = index;
    setSelectedCommandIndex(index);
  }, []);

  const selectCommand = useCallback((command: string) => {
    setMessage(`${command} `);
    clearCommandSuggestions();
  }, [clearCommandSuggestions, setMessage]);

  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const createConversation = kana.createConversation;
  const selectConversation = kana.selectConversation;
  const renameConversation = kana.renameConversation;
  const deleteConversation = kana.deleteConversation;
  const createConversationFromSidebar = useCallback(() => {
    void createConversation();
    setHistoryOpen(false);
  }, [createConversation]);
  const selectConversationFromSidebar = useCallback((id: string) => {
    selectConversation(id);
    setHistoryOpen(false);
  }, [selectConversation]);
  const renameConversationFromSidebar = useCallback((id: string, title: string) => {
    void renameConversation(id, title);
  }, [renameConversation]);
  const deleteConversationFromSidebar = useCallback((id: string) => {
    void deleteConversation(id);
  }, [deleteConversation]);

  const submit = useCallback(async () => {
    const text = message.trim();
    if (!text || connectionInTransition || (kana.busy && !canSubmitWhileBusy)) return;
    const confirmation = destructiveCommandPrompt(text);
    if (confirmation && !window.confirm(confirmation)) return;
    setMessage("");
    const prefill = await kana.sendMessage(text);
    if (prefill) setMessage(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, connectionInTransition, kana.busy, canSubmitWhileBusy, kana.sendMessage, setMessage]);

  const commandSuggestions = kana.commandSuggestions;
  const commandSuggestionsRef = useRef(commandSuggestions);
  useEffect(() => {
    commandSuggestionsRef.current = commandSuggestions;
  }, [commandSuggestions]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const suggestions = commandSuggestionsRef.current;
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      highlightCommand((selectedCommandIndexRef.current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      highlightCommand((selectedCommandIndexRef.current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if ((event.key === "Tab" || event.key === "Enter") && suggestions.length > 0) {
      event.preventDefault();
      const selectedIndex = Math.min(selectedCommandIndexRef.current, suggestions.length - 1);
      selectCommand(suggestions[selectedIndex]?.text ?? suggestions[0].text);
      return;
    }
    if (event.key === "Escape") { clearCommandSuggestions(); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  }, [clearCommandSuggestions, highlightCommand, selectCommand, submit]);

  if (!kana.ready) {
    return (
      <main className="kana-loading">
        <div className="kana-mark">か</div>
        <p>Preparing Kana…</p>
      </main>
    );
  }

  if (showGate) {
    return (
      <main className="kana-gate">
        <div className="gate-logo">
          <div className="kana-mark">か</div>
          <h1>Kana</h1>
          <p>Hermes, with a face and a voice</p>
        </div>
        <div className={`gate-status ${kana.connectionState === "connecting" ? "checking" : ""}`}>
          <span className="dot" />
          {kana.connectionState === "connecting" ? "Connecting…" : "Hermes is not connected"}
        </div>
        <div className="gate-actions">
          <button className="primary-button" onClick={() => void kana.connectAgent()}>Connect to Hermes</button>
          <details className="gate-config">
            <summary>Connection settings</summary>
            <label>WebSocket URL<input type="text" value={kana.preferences.hermes.websocketUrl} placeholder="ws://127.0.0.1:9119/api/ws" onChange={(event) => void kana.savePreferences({ ...kana.preferences, hermes: { ...kana.preferences.hermes, websocketUrl: event.target.value } })} /></label>
            <label>Session token<input type="password" value={kana.preferences.hermes.token} placeholder="session token" autoComplete="off" onChange={(event) => void kana.savePreferences({ ...kana.preferences, hermes: { ...kana.preferences.hermes, token: event.target.value } })} /></label>
          </details>
        </div>
      </main>
    );
  }

  return (
    <main className="kana-shell">
      <AvatarStage
        avatar={kana.avatar}
        status={kana.status}
        busy={kana.busy}
        onCanvasReady={kana.attachAvatarCanvas}
      />

      <div className="subtitle-overlay">
        <p className={`subtitle-text${latestAssistant?.subtitle?.text ? "" : " idle"}`}>
          {latestAssistant?.subtitle?.text || "Kana is listening…"}
        </p>
        {latestAssistant?.subtitle ? (
          <span className="subtitle-lang">{latestAssistant.subtitle.language.toUpperCase()}</span>
        ) : null}
      </div>

      <div className="composer-overlay">
        <SlashCommandMenu
          suggestions={kana.commandSuggestions}
          loading={kana.commandSuggestionsLoading}
          selectedIndex={activeCommandIndex}
          onHighlight={highlightCommand}
          onSelect={selectCommand}
        />
        <div className="composer-row">
          <form style={{ display: "contents" }} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <textarea
              id="kana-message"
              className="composer-input"
              ref={inputRef}
              value={message}
              aria-activedescendant={kana.commandSuggestions.length ? `kana-command-option-${activeCommandIndex}` : undefined}
              aria-controls={kana.commandSuggestions.length ? "kana-command-menu" : undefined}
              aria-autocomplete="list"
              onChange={(event) => { highlightCommand(0); setMessage(event.target.value); }}
              onKeyDown={onKeyDown}
              placeholder={connectionInTransition ? "Reconnecting…" : kana.busy ? "Use /approve, /deny…" : "Type a message…"}
              rows={1}
            />
          </form>
          <span className="composer-lang">{kana.preferences.subtitleLanguage.toUpperCase()}</span>
          {kana.busy ? (
            <>
              {canSubmitWhileBusy ? <button className="composer-run" type="button" onClick={() => void submit()}>Run</button> : null}
              <button className="composer-stop" type="button" onClick={() => void kana.abort()}><span /> Stop</button>
            </>
          ) : (
            <button className="composer-send" type="button" onClick={() => void submit()} disabled={!message.trim() || connectionInTransition} aria-label="Send message">↑</button>
          )}
        </div>
      </div>

      <div className="top-actions">
        <button className="icon-btn" onClick={() => setHistoryOpen(true)} aria-label="Conversation history">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="3" width="14" height="11" rx="2"/><line x1="1" y1="7" x2="15" y2="7"/><line x1="5" y1="3" x2="5" y2="1"/><line x1="11" y1="3" x2="11" y2="1"/></svg>
        </button>
        <span className={`conn-dot ${kana.connectionState}`} title={kana.connectionState.replaceAll("_", " ")} />
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button>
      </div>

      <div className={`history-panel${historyOpen ? " open" : ""}`} aria-hidden={!historyOpen} inert={historyOpen ? undefined : true}>
        <div className="history-panel-header">
          <span>Messages</span>
          <button className="icon-btn" aria-label="Close history" onClick={closeHistory}>×</button>
        </div>
        <div className="history-panel-body">
          <DialogueHistory messages={kana.activeConversation?.messages ?? NO_MESSAGES} />
        </div>
      </div>
      {historyOpen ? <button className="sidebar-backdrop" aria-label="Close" onClick={closeHistory} /> : null}

      <div className={`conv-panel${historyOpen ? " open" : ""}`} aria-hidden={!historyOpen} inert={historyOpen ? undefined : true}>
        <div className="conv-panel-header">
          <span>Conversations</span>
          <button className="icon-btn" aria-label="Close" onClick={closeHistory}>×</button>
        </div>
        <ConversationSidebar
          conversations={kana.conversations}
          activeId={kana.activeConversation?.id}
          disabled={kana.busy}
          onCreate={createConversationFromSidebar}
          onSelect={selectConversationFromSidebar}
          onRename={renameConversationFromSidebar}
          onDelete={deleteConversationFromSidebar}
          onClose={closeHistory}
        />
      </div>

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
          onPrepareHermesCommand={(command) => { setMessage(command); setSettingsOpen(false); window.setTimeout(() => inputRef.current?.focus(), 0); }}
          onReplayVoice={kana.replayVoice}
          onStopVoice={kana.stopVoice}
          onExportBackup={kana.exportLocalBackup}
          onImportBackup={kana.importLocalBackup}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {kana.pendingInput ? (
        <AgentInputDialog
          key={kana.pendingInput.kind === "approval" ? `approval-${kana.pendingInput.command}` : `${kana.pendingInput.kind}-${kana.pendingInput.requestId}`}
          request={kana.pendingInput}
          submitting={kana.respondingToInput}
          onRespond={kana.respondToInput}
        />
      ) : null}

      {!kana.preferences.onboardingCompleted ? (
        <OnboardingDialog preferences={kana.preferences} onTestAgent={kana.testAgentConnection} onComplete={kana.savePreferences} />
      ) : null}
    </main>
  );
}