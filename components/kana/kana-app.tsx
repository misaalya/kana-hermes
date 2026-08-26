"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { LiveChatFeed } from "./live-chat-feed";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { OnboardingWizard, type DependencyFindings } from "./onboarding-dialog";
import { useKanaController } from "@/lib/state/use-kana-controller";
import { useTheme } from "@/lib/state/use-theme";
import type { KanaMessage } from "@/lib/conversation/types";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import {
  fetchSetupState,
  markOnboardingComplete,
} from "@/lib/runtime/setup-client";
import { getCopy } from "@/lib/ui/copy";
import type { KanaPreferences } from "@/lib/preferences/types";
import { btnPrimary } from "./ui";

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
  const { theme, toggleTheme } = useTheme();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [connectionGateOpen, setConnectionGateOpen] = useState(false);
  const [connectionGateDismissed, setConnectionGateDismissed] = useState(false);
  const [automaticConnectFinished, setAutomaticConnectFinished] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [hermesRuntime, setHermesRuntime] = useState<HermesRuntimeStatus | null>(null);
  const [hermesRuntimeNotice, setHermesRuntimeNotice] = useState<string | null>(null);
  const [hermesRuntimeBusy, setHermesRuntimeBusy] = useState(false);
  // Install-level setup state (server SQLite) + dependency findings drive the
  // wizard: full mode runs once per installation, repair mode once per
  // browser session while a dependency is unhealthy.
  const [deps, setDeps] = useState<DependencyFindings>({ hermes: "installed", voice: null });
  const [wizardMode, setWizardMode] = useState<null | "full" | "repair">(null);
  const selectedCommandIndexRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const automaticConnectStartedRef = useRef(false);
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
  const connectionFailed =
    kana.connectionState === "error" ||
    kana.connectionState === "authentication_failed" ||
    kana.connectionState === "incompatible";
  const showGate =
    kana.ready &&
    !wizardMode &&
    (connectionGateOpen ||
      (!connectionGateDismissed && automaticConnectFinished && connectionFailed)) &&
    kana.connectionState !== "connected";
  const detectedExternalGateway = Boolean(
    hermesRuntime?.state === "running" && !hermesRuntime.managed,
  );

  // ---- Smart connect flow ----
  const connectionStateRef = useRef(kana.connectionState);
  useEffect(() => {
    connectionStateRef.current = kana.connectionState;
  });
  const isHermesConnected = useCallback(
    () => connectionStateRef.current === "connected",
    [],
  );

  const [connectPhase, setConnectPhase] = useState<"idle" | "connecting" | "auto_starting">("idle");

  const startHermesGateway = useCallback(async () => {
    setHermesRuntimeBusy(true);
    setHermesRuntimeNotice(null);
    try {
      const status = await kana.startHermesControl({
        port: hermesRuntime?.port ?? 9119,
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
  }, [kana, hermesRuntime]);

  const handleConnectHermes = useCallback(async () => {
    if (connectionInTransition) return;
    setConnectionGateDismissed(false);
    setConnectPhase("connecting");
    setHermesRuntimeNotice(null);

    // Step 1: try the relay first — the server may already run Hermes.
    await kana.connectAgent();

    // Step 2: wait for React to flush the connection-state update
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Step 3: if already connected we are done
    if (isHermesConnected()) {
      setAutomaticConnectFinished(true);
      setConnectionGateOpen(false);
      setConnectPhase("idle");
      return;
    }

    // Step 4: smart flow — auto-start the managed gateway when installed
    let runtime = hermesRuntime;
    if (!runtime) {
      try {
        runtime = await kana.inspectHermesControl();
        setHermesRuntime(runtime);
      } catch {
        runtime = null;
      }
    }
    if (runtime?.executable && runtime.state !== "running") {
      setConnectPhase("auto_starting");
      try {
        await startHermesGateway();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await kana.connectAgent();
      } catch { /* fall through */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isHermesConnected()) {
      setConnectionGateOpen(true);
    } else {
      setConnectionGateOpen(false);
    }
    setAutomaticConnectFinished(true);
    setConnectPhase("idle");
  }, [kana, connectionInTransition, hermesRuntime, isHermesConnected, startHermesGateway]);

  // Each page load performs one automatic connection attempt. Successful
  // reconnects stay invisible; the recovery modal appears only after that
  // attempt genuinely fails. The agent client handles later stream drops with
  // its bounded reconnect policy.
  useEffect(() => {
    if (!kana.ready || automaticConnectStartedRef.current) return;
    automaticConnectStartedRef.current = true;
    void handleConnectHermes();
  }, [handleConnectHermes, kana.ready]);

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

  // Setup wizard driver. The full run is keyed on the SERVER-side flag (once
  // per installation); dependency degradation opens a repair run at most once
  // per browser session so a broken cache never nags repeatedly.
  const repairSeenKey = "kana.repairPrompt.seen";
  useEffect(() => {
    if (!kana.ready) return;
    let active = true;
    void (async () => {
      const state = await fetchSetupState();
      if (!active) return;

      let hermes: DependencyFindings["hermes"] = "installed";
      try {
        const status = await kana.inspectHermesControl();
        if (active) setHermesRuntime(status);
        hermes =
          status.state === "running" || Boolean(status.executable)
            ? "installed"
            : "missing";
        if (status.state === "running") hermes = "running";
      } catch {
        hermes = "missing";
      }

      let voice: DependencyFindings["voice"] = null;
      if (kana.preferences.voiceEnabled) {
        try {
          const status = await kana.inspectVoiceService(kana.preferences.qwen3Tts.baseUrl);
          voice =
            status.state === "error"
              ? "error"
              : status.state === "loading"
                ? "loading"
                : status.state === "ready"
                  ? "ok"
                  : "stopped";
        } catch {
          voice = "error";
        }
      }
      if (!active) return;
      const findings = { hermes, voice };
      setDeps(findings);

      const degraded = findings.hermes === "missing" || findings.voice === "error";
      if (state && !state.onboardingCompleted) {
        setWizardMode("full");
      } else if (
        degraded &&
        state?.onboardingCompleted !== false &&
        !window.sessionStorage.getItem(repairSeenKey)
      ) {
        window.sessionStorage.setItem(repairSeenKey, "1");
        setWizardMode("repair");
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kana.ready]);

  const completeWizard = useCallback(
    async (next: KanaPreferences) => {
      // Server flag first: it is the source other browsers read.
      await markOnboardingComplete();
      await kana.savePreferences({ ...next, onboardingCompleted: true });
      setWizardMode(null);
    },
    [kana],
  );

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

  if (!kana.ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <p className="text-[10px] font-bold tracking-[0.18em] text-muted uppercase animate-kana-pulse">Preparing Kana</p>
      </main>
    );
  }

  const gateCopy = getCopy(kana.preferences.uiLocale).gate;
  const connectButtonLabel = connectionInTransition
    ? gateCopy.connecting
    : connectPhase === "auto_starting"
      ? gateCopy.startButton
      : gateCopy.connectButton;

  const gateFailed =
    kana.connectionState === "error" ||
    kana.connectionState === "authentication_failed" ||
    kana.connectionState === "incompatible";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <AvatarStage
        avatar={kana.avatar}
        onCanvasReady={kana.attachAvatarCanvas}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 p-4 max-sm:p-3">
        <div className="pointer-events-auto min-w-0 max-sm:hidden">
          <div className="min-w-0">
            <p className="text-base font-bold tracking-wide text-ink">Kana</p>
            <p className="max-w-[34vw] truncate text-[10px] text-muted max-sm:max-w-[38vw]">
              {kana.activeConversation?.title ?? "A new moment"}
            </p>
          </div>
        </div>

        <nav className="pointer-events-auto ml-auto flex items-center gap-1 border border-line bg-raised p-1" aria-label="Workspace actions">
          <button
            type="button"
            className="kana-focus min-h-8 px-2.5 text-[10px] font-semibold text-muted hover:bg-surface-strong hover:text-ink"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button
            type="button"
            className="kana-focus min-h-8 px-2.5 text-[10px] font-semibold text-muted hover:bg-surface-strong hover:text-ink"
            onClick={() => setSessionsOpen(true)}
            aria-label="Open conversation history"
          >
            History
          </button>
          <button
            type="button"
            className="kana-focus min-h-8 px-2.5 text-[10px] font-semibold text-muted hover:bg-surface-strong hover:text-ink"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            Settings
          </button>
        </nav>
      </header>

      <section className="kana-panel absolute bottom-4 right-4 top-[76px] z-10 flex w-[min(34vw,480px)] min-w-[390px] flex-col overflow-hidden rounded-2xl max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-auto max-lg:h-[46dvh] max-lg:w-full max-lg:min-w-0 max-lg:rounded-none max-sm:inset-0 max-sm:h-full max-sm:border-0 max-sm:bg-transparent">
        <div className="flex min-h-0 flex-1">
          <LiveChatFeed
            messages={kana.activeConversation?.messages ?? NO_MESSAGES}
            activities={kana.activities}
            serverActivityTurns={kana.serverActivityTurns}
            busy={kana.busy}
            status={kana.status}
          />
        </div>
        <div className="shrink-0 border-t border-line bg-raised p-3 max-sm:px-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:pt-2">
          <div className="relative">
            <SlashCommandMenu
              suggestions={kana.commandSuggestions}
              loading={kana.commandSuggestionsLoading}
              selectedIndex={activeCommandIndex}
              onHighlight={highlightCommand}
              onSelect={selectCommand}
            />
            <div className="flex items-end gap-2 border border-line-strong bg-surface-strong p-2 transition-colors focus-within:border-accent/45">
              <textarea
                id="kana-message"
                ref={inputRef}
                value={message}
                rows={1}
                placeholder="Say something to Kana…"
                aria-label="Message Kana"
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[13px] leading-snug text-ink placeholder:text-faint focus:outline-none"
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
                  className="kana-focus min-h-10 shrink-0 border border-danger/40 px-3 text-[11px] font-bold text-danger transition-colors hover:bg-danger/10"
                  onClick={() => void kana.abort()}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Send"
                  disabled={!message.trim() || (kana.busy && !canSubmitWhileBusy)}
                  className="kana-focus min-h-10 shrink-0 bg-accent px-3 text-[11px] font-bold text-on-accent transition-[background-color,opacity] hover:bg-accent-hover disabled:opacity-35"
                  onClick={() => void submitMessage()}
                >
                  Send
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 px-1 text-[9px] text-faint max-sm:hidden">
            Enter to send · Shift + Enter for a new line · Type / for Hermes actions
          </p>
        </div>
      </section>

      {/* Session history modal */}
      {sessionsOpen ? (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-[var(--backdrop)] p-3 max-sm:p-0"
          role="dialog"
          aria-modal="true"
          aria-label="Conversation history"
          onClick={closeSessions}
        >
          <section
            className="kana-panel flex h-full w-[min(420px,100%)] flex-col overflow-hidden rounded-2xl animate-kana-in max-sm:rounded-none"
            onClick={(event) => event.stopPropagation()}
          >
            <ConversationSidebar
              conversations={kana.conversations}
              activeId={kana.activeConversation?.id}
              disabled={kana.busy}
              hermesSessions={kana.hermesSessions}
              onAdopt={(session) => void kana.adoptHermesSession(session)}
              onCreate={createConversationFromModal}
              onSelect={selectConversationFromModal}
              onRename={renameConversationFromModal}
              onDelete={deleteConversationFromModal}
              onClose={closeSessions}
            />
          </section>
        </div>
      ) : null}

      {showGate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[var(--backdrop)] p-4" role="dialog" aria-modal="true" aria-label="Hermes gateway">
          <div className="kana-panel flex w-full max-w-sm flex-col items-center rounded-2xl p-6 text-center animate-kana-in">
            <p className="text-[10px] font-bold tracking-[0.16em] text-muted uppercase">Kana needs Hermes</p>
            <h2 className="mt-1 text-lg font-bold text-ink">Connect the mind behind Kana</h2>
            <p className="mt-2 max-w-[290px] text-[11px] leading-relaxed text-muted">
              Kana will find or start your existing Hermes installation automatically.
            </p>
            <div
              className={`mt-5 border px-3 py-1.5 text-[10px] font-semibold ${
                connectionInTransition
                  ? "border-accent/35 bg-accent/8 text-accent-strong"
                  : gateFailed
                    ? "border-danger/35 bg-danger/8 text-danger"
                    : "border-line-strong text-muted"
              }`}
            >
              {kana.connectionState === "connecting"
                ? gateCopy.connecting
                : kana.connectionState === "reconnecting"
                  ? gateCopy.reconnecting
                  : kana.connectionState === "authentication_failed"
                    ? gateCopy.authInvalid
                    : kana.connectionState === "incompatible"
                      ? gateCopy.incompatible
                      : kana.connectionState === "error"
                        ? gateCopy.failed
                        : gateCopy.idle}
            </div>

            <button
              className={`${btnPrimary} mt-5 w-full text-sm`}
              onClick={handleConnectHermes}
              disabled={connectionInTransition || connectPhase === "auto_starting"}
            >
              {connectButtonLabel}
            </button>

            <button
              type="button"
              className="kana-focus mt-2 min-h-9 w-full text-xs font-semibold text-muted hover:bg-surface-strong hover:text-ink"
              onClick={() => {
                setConnectionGateOpen(false);
                setConnectionGateDismissed(true);
              }}
              disabled={connectionInTransition || connectPhase === "auto_starting"}
            >
              Not now
            </button>

            {hermesRuntime?.controlAvailable ? (
              <div className="mt-3 flex w-full flex-col items-center gap-1 text-[9px] leading-relaxed">
                {detectedExternalGateway ? (
                  <p className="text-faint">{gateCopy.detectedExternal(hermesRuntime.port)}</p>
                ) : hermesRuntime.state === "running" && hermesRuntime.managed ? (
                  <p className="text-faint">{gateCopy.managedRunning(hermesRuntime.pid ?? null)}</p>
                ) : hermesRuntime.executable ? (
                  <p className="text-faint">{hermesRuntimeBusy ? gateCopy.startButton : gateCopy.installedReady}</p>
                ) : (
                  <p className="text-faint">{gateCopy.missingBinary}</p>
                )}
                {hermesRuntimeNotice ? (
                  <p role="status" className="max-w-full break-words text-faint">{hermesRuntimeNotice}</p>
                ) : null}
                <p className="mt-1 text-faint">{gateCopy.relayNote}</p>
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

      {wizardMode ? (
        <OnboardingWizard
          locale={kana.preferences.uiLocale}
          preferences={kana.preferences}
          deps={deps}
          mode={wizardMode}
          onComplete={completeWizard}
          onDismiss={() => setWizardMode(null)}
          onOpenSettings={() => {
            setWizardMode(null);
            setSettingsOpen(true);
          }}
        />
      ) : null}

      {!wizardMode && (deps.hermes === "missing" || deps.voice === "error") ? (
        <DegradedBanner
          locale={kana.preferences.uiLocale}
          onCheck={() => setWizardMode("repair")}
        />
      ) : null}
    </main>
  );
}

function DegradedBanner({
  locale,
  onCheck,
}: {
  locale: KanaPreferences["uiLocale"];
  onCheck(): void;
}) {
  const copy = getCopy(locale);
  return (
    <div className="kana-panel absolute bottom-5 left-5 z-20 flex max-w-[360px] items-center gap-3 rounded-md px-3.5 py-2.5 max-lg:bottom-[calc(46dvh+12px)] max-sm:bottom-auto max-sm:left-3 max-sm:top-16">
      <p className="text-[10px] font-semibold text-ink-dim">{copy.banner.degraded}</p>
      <button
        type="button"
        className="kana-focus rounded-lg px-2 py-1 text-[10px] font-bold text-accent-strong hover:bg-accent/10"
        onClick={onCheck}
      >
        {copy.banner.action}
      </button>
    </div>
  );
}
