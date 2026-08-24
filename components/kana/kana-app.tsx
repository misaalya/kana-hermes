"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { DialogueHistory } from "./dialogue-history";
import { LiveChatFeed } from "./live-chat-feed";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { OnboardingDialog } from "./onboarding-dialog";
import { useKanaController } from "@/lib/state/use-kana-controller";
import { useTheme } from "@/lib/state/use-theme";
import type { KanaMessage } from "@/lib/conversation/types";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { btnPrimary, btnSecondary } from "./ui";

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

const gateInputClass =
  "min-h-9 w-full rounded-xl border border-line-strong bg-transparent px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

export function KanaApp({ appVersion }: KanaAppProps) {
  const kana = useKanaController(appVersion);
  const { theme, toggleTheme } = useTheme();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Independent modals: chat transcript vs. Hermes session list. Opening one
  // must never drag the other along (the old shared `historyOpen` flag stacked
  // a bottom sheet and a right drawer on top of each other).
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [hermesRuntime, setHermesRuntime] = useState<HermesRuntimeStatus | null>(null);
  const [hermesRuntimeNotice, setHermesRuntimeNotice] = useState<string | null>(null);
  const [hermesRuntimeBusy, setHermesRuntimeBusy] = useState(false);
  const selectedCommandIndexRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { clearCommandSuggestions } = kana;
  // Latest-ref mirror: the typing effect below must fire only when the message
  // changes, not whenever controller identities churn between renders.
  const completeCommandsRef = useRef(kana.completeCommands);
  useEffect(() => {
    completeCommandsRef.current = kana.completeCommands;
  });

  const activeConversationId = kana.activeConversation?.id;
  const message = activeConversationId ? drafts[activeConversationId] ?? "" : "";
  const setMessage = useCallback((value: string) => {
    setDrafts((current) => {
      if (!activeConversationId) return current;
      if (current[activeConversationId] === value) return current;
      return { ...current, [activeConversationId]: value };
    });
  }, [activeConversationId]);

  const commandName = /^\/([^\s/]+)/.exec(message.trim())?.[1]?.toLowerCase();
  const canSubmitWhileBusy = Boolean(
    commandName && ["approve", "deny", "queue", "steer", "status", "agents", "goal", "heartbeat", "background"].includes(commandName.replaceAll("_", "-")),
  );
  const connectionInTransition = kana.connectionState === "connecting" || kana.connectionState === "reconnecting";
  const activeCommandIndex = Math.min(selectedCommandIndex, Math.max(0, kana.commandSuggestions.length - 1));
  const showGate = kana.ready && kana.connectionState !== "connected";
  const gateConnectAttemptsRef = useRef(0);
  const detectedExternalGateway = Boolean(
    hermesRuntime?.state === "running" && !hermesRuntime.managed,
  );

  // ---- Smart connect flow ----
  const connectionStateRef = useRef(kana.connectionState);
  useEffect(() => {
    connectionStateRef.current = kana.connectionState;
  });

  const [connectPhase, setConnectPhase] = useState<"idle" | "connecting" | "auto_starting">("idle");

  const startHermesGateway = useCallback(async () => {
    setHermesRuntimeBusy(true);
    setHermesRuntimeNotice(null);
    try {
      const status = await kana.startHermesControl({
        port: hermesRuntime?.port ?? 9119,
        cwd: kana.preferences.hermes.cwd || undefined,
      });
      setHermesRuntime(status);
      setHermesRuntimeNotice(status.message);
      await kana.connectAgent();
    } catch (error) {
      setHermesRuntimeNotice(
        error instanceof Error ? error.message : "Could not start the Hermes gateway.",
      );
      try {
        setHermesRuntime(await kana.inspectHermesControl());
      } catch {}
    } finally {
      setHermesRuntimeBusy(false);
    }
  }, [kana, hermesRuntime?.port]);

  const handleConnectHermes = useCallback(async () => {
    if (connectionInTransition) return;
    gateConnectAttemptsRef.current = 100;
    setConnectPhase("connecting");

    // Step 1: try the relay first — the server may already run Hermes.
    await kana.connectAgent();

    // Step 2: wait for React to flush the connection-state update
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Step 3: if already connected we are done
    if (connectionStateRef.current === "connected") {
      setConnectPhase("idle");
      return;
    }

    // Step 4: smart flow — auto-start the managed gateway when installed
    if (hermesRuntime?.executable && hermesRuntime.state !== "running") {
      setConnectPhase("auto_starting");
      try {
        await startHermesGateway();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await kana.connectAgent();
      } catch { /* fall through */ }
      setConnectPhase("idle");
      return;
    }
    setConnectPhase("idle");
  }, [kana, connectionInTransition, hermesRuntime, startHermesGateway]);

  // A reachable Hermes relay is normally auto-connected right away. When the
  // gateway is down, retrying on every gate appearance remounts the whole shell
  // (and the WebGL canvas) in a tight loop and starves the UI thread, so bound
  // the automatic attempts and leave further retries to the manual button.
  useEffect(() => {
    gateConnectAttemptsRef.current = 0;
  }, []);

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
  }, [showGate]);

  // Local gateway control: the gate checks whether the server-side Hermes
  // runtime is already listening; if not, Kana can start one itself and the
  // relay connects automatically. No token entry — the server holds it.
  useEffect(() => {
    if (!showGate) return;
    let active = true;
    kana.inspectHermesControl()
      .then((status) => { if (active) setHermesRuntime(status); })
      .catch(() => { if (active) setHermesRuntime(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGate]);

  useEffect(() => {
    if (!message.startsWith("/")) { clearCommandSuggestions(); return; }
    const timer = window.setTimeout(() => { void completeCommandsRef.current(message); }, 120);
    return () => window.clearTimeout(timer);
  }, [clearCommandSuggestions, message]);

  const highlightCommand = useCallback((index: number) => {
    selectedCommandIndexRef.current = index;
    setSelectedCommandIndex(index);
  }, []);

  const selectCommand = useCallback((command: string) => {
    setMessage(`${command} `);
    clearCommandSuggestions();
  }, [clearCommandSuggestions, setMessage]);

  const closeMessages = useCallback(() => setMessagesOpen(false), []);
  const closeSessions = useCallback(() => setSessionsOpen(false), []);
  const createConversation = kana.createConversation;
  const selectConversation = kana.selectConversation;
  const renameConversation = kana.renameConversation;
  const deleteConversation = kana.deleteConversation;
  const createConversationFromModal = useCallback(() => {
    void createConversation();
    setSessionsOpen(false);
  }, [createConversation]);
  const selectConversationFromModal = useCallback((id: string) => {
    selectConversation(id);
    setSessionsOpen(false);
  }, [selectConversation]);
  const renameConversationFromModal = useCallback((id: string, title: string) => {
    void renameConversation(id, title);
  }, [renameConversation]);
  const deleteConversationFromModal = useCallback((id: string) => {
    void deleteConversation(id);
  }, [deleteConversation]);

  const submitMessage = useCallback(async () => {
    const text = message.trim();
    if (!text) return;
    const confirmation = destructiveCommandPrompt(text);
    if (confirmation && !window.confirm(confirmation)) return;
    setMessage("");
    const prefill = await kana.sendMessage(text);
    if (prefill) setMessage(prefill);
  }, [kana, message, setMessage]);

  const topActionIcon =
    "grid size-8 place-items-center rounded-lg border border-line bg-raised text-ink-dim transition-colors hover:border-accent hover:text-accent-strong";

  const themeToggle = (
    <button type="button" className={topActionIcon} onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        {theme === "dark" ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" strokeLinecap="round" />
          </>
        ) : (
          <path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );

  if (!kana.ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <p className="animate-kana-pulse text-xs font-semibold tracking-widest text-muted uppercase">Preparing Kana…</p>
      </main>
    );
  }

  const connectButtonLabel = connectionInTransition
    ? "Menghubungkan…"
    : connectPhase === "auto_starting"
      ? "Memulai Hermes…"
      : "Koneksikan Hermes";

  const gateFailed =
    kana.connectionState === "error" ||
    kana.connectionState === "authentication_failed" ||
    kana.connectionState === "incompatible";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <AvatarStage
        avatar={kana.avatar}
        busy={kana.busy}
        onCanvasReady={kana.attachAvatarCanvas}
      />

      {/* Top-right icon row — the only chrome over the avatar */}
      <div className="absolute right-3 top-3 z-20 flex gap-1.5">
        {themeToggle}
        <button type="button" className={topActionIcon} onClick={() => { setMessagesOpen(true); }} aria-label="Open message history">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M14.5 8A6.5 6.5 0 1 1 8 1.5c3.2 0 6.5 2.4 6.5 6.5Z"/><path d="M5 7h6M5 9.5h4" strokeLinecap="round"/></svg>
        </button>
        <button type="button" className={topActionIcon} onClick={() => { setSessionsOpen(true); }} aria-label="Open session history">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="3" width="13" height="11" rx="2"/><line x1="1.5" y1="6.5" x2="14.5" y2="6.5"/><line x1="5" y1="3" x2="5" y2="1.5"/><line x1="11" y1="3" x2="11" y2="1.5"/></svg>
        </button>
        <button type="button" className={topActionIcon} onClick={() => setSettingsOpen(true)} aria-label="Open settings">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Live-chat feed (vtuber style): a height-capped, scrollable column
          anchored to the LEFT edge. Holds the chronological stream — user
          messages, tool activity lines, Kana's reply — so long responses
          scroll inside the column and never cover the avatar stage. The
          bottom padding keeps the feed above the composer instead of
          sliding underneath it. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[min(88%,480px)] flex-col justify-end p-3 pb-24 max-md:inset-x-0 max-md:w-full max-md:pb-20">
        <div className="pointer-events-auto min-h-0">
          <LiveChatFeed
            messages={kana.activeConversation?.messages ?? NO_MESSAGES}
            activities={kana.activities}
            busy={kana.busy}
            status={kana.status}
          />
        </div>
      </div>

      {/* Composer */}
      <section className="absolute inset-x-0 bottom-0 z-20 px-4 pb-4">
        <div className="relative mx-auto w-full max-w-3xl">
          <SlashCommandMenu
            suggestions={kana.commandSuggestions}
            loading={kana.commandSuggestionsLoading}
            selectedIndex={activeCommandIndex}
            onHighlight={highlightCommand}
            onSelect={selectCommand}
          />
          <div className="flex items-end gap-2 rounded-3xl border border-line bg-raised/85 p-2 backdrop-blur-md">
          <textarea
            ref={inputRef}
            value={message}
            rows={1}
            placeholder="Tulis pesan…"
            aria-label="Message Kana"
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-snug text-ink placeholder:text-faint focus:outline-none"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (kana.commandSuggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  highlightCommand((activeCommandIndex + 1) % kana.commandSuggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  highlightCommand(
                    (activeCommandIndex - 1 + kana.commandSuggestions.length) % kana.commandSuggestions.length,
                  );
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  setMessage(kana.commandSuggestions[activeCommandIndex]?.text ?? message);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  clearCommandSuggestions();
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitMessage();
              }
            }}
          />
          {kana.busy ? (
            <button
              type="button"
              aria-label="Stop"
              className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong text-muted transition-colors hover:border-danger hover:text-danger"
              onClick={() => void kana.abort()}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!message.trim() || (kana.busy && !canSubmitWhileBusy)}
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-on-accent transition-opacity disabled:opacity-40"
              onClick={() => void submitMessage()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8L13.5 2.5 10.5 8l3 5.5L2.5 8z"/></svg>
            </button>
          )}
          </div>
        </div>
      </section>

      {/* Message history modal */}
      {messagesOpen ? (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Message history"
          onClick={closeMessages}
        >
          <section
            className="flex h-[min(70dvh,560px)] w-full max-w-lg flex-col rounded-3xl border border-line bg-raised p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-ink-dim uppercase">Messages</span>
              <button type="button" className={topActionIcon} aria-label="Close message history" onClick={closeMessages}>×</button>
            </header>
            <DialogueHistory messages={kana.activeConversation?.messages ?? NO_MESSAGES} />
          </section>
        </div>
      ) : null}

      {/* Session history modal */}
      {sessionsOpen ? (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Session history"
          onClick={closeSessions}
        >
          <section
            className="flex h-[min(70dvh,560px)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-raised p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <ConversationSidebar
              conversations={kana.conversations}
              activeId={kana.activeConversation?.id}
              disabled={kana.busy}
              onCreate={createConversationFromModal}
              onSelect={selectConversationFromModal}
              onRename={renameConversationFromModal}
              onDelete={deleteConversationFromModal}
              onClose={closeSessions}
            />
          </section>
        </div>
      ) : null}

      {/* Gate modal — overlay when Hermes is not connected */}
      {showGate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/70 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Hermes gateway">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-line bg-bg p-5 text-center">
            {/* Status indicator */}
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                connectionInTransition
                  ? "border-accent/50 text-accent-strong"
                  : gateFailed
                    ? "border-danger/50 text-danger"
                    : "border-line-strong text-muted"
              }`}
            >
              <span className={`size-1.5 rounded-full ${connectionInTransition ? "bg-accent animate-kana-pulse" : gateFailed ? "bg-danger" : "bg-faint"}`} />
              {kana.connectionState === "connecting"
                ? "Menghubungkan…"
                : kana.connectionState === "reconnecting"
                  ? "Menghubungkan ulang…"
                  : kana.connectionState === "authentication_failed"
                    ? "Sesi Kana tidak valid"
                    : kana.connectionState === "incompatible"
                      ? "Versi Hermes tidak kompatibel"
                      : kana.connectionState === "error"
                        ? "Koneksi gagal"
                        : "Hermes tidak terhubung"}
            </div>

            {/* Primary action */}
            <button
              className={`${btnPrimary} h-10 w-full text-sm`}
              onClick={handleConnectHermes}
              disabled={connectionInTransition || connectPhase === "auto_starting"}
            >
              {connectButtonLabel}
            </button>

            {/* Runtime detection feedback */}
            {hermesRuntime?.controlAvailable ? (
              <div className="flex w-full flex-col items-center gap-1.5 text-[10px] leading-relaxed">
                {detectedExternalGateway ? (
                  <p className="text-faint">{`Hermes gateway terdeteksi di port ${hermesRuntime.port}.`}</p>
                ) : hermesRuntime.state === "running" && hermesRuntime.managed ? (
                  <p className="text-faint">{`Hermes sedang berjalan (PID ${hermesRuntime.pid ?? "—"}).`}</p>
                ) : hermesRuntime.executable ? (
                  <p className="text-faint">{hermesRuntimeBusy ? "Memulai Hermes…" : "Hermes terpasang, siap dijalankan."}</p>
                ) : (
                  <p className="text-faint">Pasang Hermes atau atur KANA_HERMES_BIN.</p>
                )}
                {hermesRuntimeNotice ? (
                  <p role="status" className="max-w-full break-words text-faint">{hermesRuntimeNotice}</p>
                ) : null}
                <p className="text-faint">Koneksi diproses di server Kana — token tidak diperlukan di browser.</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          preferences={kana.preferences}
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
        <OnboardingDialog preferences={kana.preferences} onComplete={kana.savePreferences} />
      ) : null}
    </main>
  );
}
