"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { DialogueHistory } from "./dialogue-history";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { OnboardingDialog } from "./onboarding-dialog";
import { ActivityStack } from "./activity-stack";
import { useKanaController } from "@/lib/state/use-kana-controller";
import { useTheme } from "@/lib/state/use-theme";
import type { KanaMessage } from "@/lib/conversation/types";
import {
  generatedSessionToken,
  hermesPortFromWebSocketUrl,
} from "@/lib/runtime/hermes-control-client";
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

function hermesPortFromUrl(url: string): number {
  return hermesPortFromWebSocketUrl(url);
}

function hermesUrlIsLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [hermesRuntime, setHermesRuntime] = useState<HermesRuntimeStatus | null>(null);
  const [hermesRuntimeNotice, setHermesRuntimeNotice] = useState<string | null>(null);
  const [hermesRuntimeBusy, setHermesRuntimeBusy] = useState(false);
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
  const showGate = kana.ready && kana.preferences.agentMode === "hermes" && kana.connectionState !== "connected";
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

  // Local gateway control: when Kana runs against a local WebSocket URL, the
  // gate first checks whether a `hermes serve` process is already listening.
  // A detected external gateway only needs the user's session token; if none
  // is running, Kana can start one itself and connect automatically.
  useEffect(() => {
    if (!showGate) return;
    let active = true;
    kana.inspectHermesControl(hermesPortFromUrl(kana.preferences.hermes.websocketUrl))
      .then((status) => { if (active) setHermesRuntime(status); })
      .catch(() => { if (active) setHermesRuntime(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGate]);

  // An externally started gateway wins: adopt its exact WebSocket URL so the
  // user only has to provide the session token before connecting.
  const detectedExternalGateway = Boolean(
    hermesRuntime?.state === "running" && !hermesRuntime.managed,
  );
  useEffect(() => {
    if (!detectedExternalGateway || !hermesRuntime) return;
    if (!hermesUrlIsLocal(kana.preferences.hermes.websocketUrl)) return;
    if (kana.preferences.hermes.websocketUrl === hermesRuntime.websocketUrl) return;
    void kana.savePreferences({
      ...kana.preferences,
      hermes: { ...kana.preferences.hermes, websocketUrl: hermesRuntime.websocketUrl },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedExternalGateway, hermesRuntime]);

  const startHermesGateway = useCallback(async () => {
    setHermesRuntimeBusy(true);
    setHermesRuntimeNotice(null);
    try {
      const preferences = kana.preferences;
      let token = preferences.hermes.token.trim();
      if (!token) {
        token = generatedSessionToken();
        await kana.savePreferences({
          ...preferences,
          hermes: { ...preferences.hermes, token },
        });
      }
      const status = await kana.startHermesControl({
        port: hermesPortFromUrl(kana.preferences.hermes.websocketUrl),
        token,
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
        setHermesRuntime(await kana.inspectHermesControl(hermesPortFromUrl(kana.preferences.hermes.websocketUrl)));
      } catch {
        // Keep the last known runtime state if the control endpoint fails.
      }
    } finally {
      setHermesRuntimeBusy(false);
    }
  }, [kana]);

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

  const topActionIcon =
    "grid size-8 place-items-center rounded-full border border-line bg-raised text-ink-dim transition-colors hover:border-accent hover:text-accent-strong";

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

  if (showGate) {
    const gateStateLabel =
      kana.connectionState === "connecting"
        ? "Connecting…"
        : kana.connectionState === "reconnecting"
          ? "Reconnecting…"
          : kana.connectionState === "authentication_failed"
            ? "Authentication failed"
            : kana.connectionState === "incompatible"
              ? "Incompatible Hermes version"
              : kana.connectionState === "error"
                ? "Connection error"
                : "Hermes is not connected";
    const gateFailed =
      kana.connectionState === "error" ||
      kana.connectionState === "authentication_failed" ||
      kana.connectionState === "incompatible";

    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg px-4 py-10">
        {/* Flat concentric rings */}
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line max-sm:size-64" />
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line max-sm:size-96" />

        <div className="absolute right-4 top-4 z-10 flex gap-1.5">{themeToggle}</div>

        <div className="z-[1] flex w-full max-w-xs flex-col items-center gap-5 text-center">
          <div>
            <h1 className="text-3xl font-bold tracking-wide text-ink">Kana</h1>
            <p className="mt-1 text-xs text-muted">Hermes, with a face and a voice</p>
          </div>

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
            {gateStateLabel}
          </div>

          <div className="flex w-full flex-col items-center gap-2">
            <button
              className={`${btnPrimary} h-10 w-full text-sm`}
              onClick={() => void kana.connectAgent()}
              disabled={connectionInTransition}
            >
              {kana.connectionState === "connecting"
                ? "Connecting…"
                : kana.connectionState === "reconnecting"
                  ? "Reconnecting…"
                  : gateFailed
                    ? "Retry connection"
                    : "Connect to Hermes"}
            </button>
            <p className="text-[10px] text-faint">Hermes gateway must be active to use Kana</p>

            {hermesRuntime?.controlAvailable && hermesUrlIsLocal(kana.preferences.hermes.websocketUrl) ? (
              <div className="mt-1 flex w-full flex-col items-center gap-2">
                {detectedExternalGateway ? (
                  <p role="status" className="text-[11px] text-muted">{`Hermes gateway detected on port ${hermesRuntime.port}.`}</p>
                ) : hermesRuntime.state === "running" && hermesRuntime.managed ? (
                  <p role="status" className="text-[11px] text-muted">{`Hermes gateway is running (PID ${hermesRuntime.pid ?? "—"}).`}</p>
                ) : hermesRuntime.executable ? (
                  <button
                    type="button"
                    className={`${btnSecondary} w-full`}
                    disabled={hermesRuntimeBusy || connectionInTransition}
                    onClick={() => void startHermesGateway()}
                  >
                    {hermesRuntimeBusy ? "Starting Hermes…" : "Start Hermes gateway"}
                  </button>
                ) : null}
                {detectedExternalGateway && (!kana.preferences.hermes.token || kana.connectionState === "authentication_failed") ? (
                  <label className="flex w-full flex-col items-start gap-1">
                    <span className="text-[11px] font-semibold text-muted">Session token</span>
                    <input
                      type="password"
                      value={kana.preferences.hermes.token}
                      placeholder="HERMES_DASHBOARD_SESSION_TOKEN"
                      autoComplete="off"
                      autoFocus={kana.connectionState === "authentication_failed"}
                      onChange={(event) => void kana.savePreferences({ ...kana.preferences, hermes: { ...kana.preferences.hermes, token: event.target.value } })}
                      className={gateInputClass}
                    />
                  </label>
                ) : null}
                {!hermesRuntime.executable && !detectedExternalGateway ? (
                  <p className="text-[10px] leading-relaxed text-faint">Install Hermes or set KANA_HERMES_BIN to enable one-click start.</p>
                ) : null}
                {hermesRuntimeNotice ? (
                  <p role="status" className="max-w-full break-words text-[10px] leading-relaxed text-faint">{hermesRuntimeNotice}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <details className="w-full rounded-2xl border border-line px-4 py-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-muted marker:content-none [&::-webkit-details-marker]:hidden hover:text-accent-strong">
              Connection settings
            </summary>
            <div className="mt-3 flex flex-col gap-2.5 text-left">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted">WebSocket URL</span>
                <input type="text" value={kana.preferences.hermes.websocketUrl} placeholder="ws://127.0.0.1:9119/api/ws" className={gateInputClass} onChange={(event) => void kana.savePreferences({ ...kana.preferences, hermes: { ...kana.preferences.hermes, websocketUrl: event.target.value } })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted">Session token</span>
                <input type="password" value={kana.preferences.hermes.token} placeholder="session token" autoComplete="off" className={gateInputClass} onChange={(event) => void kana.savePreferences({ ...kana.preferences, hermes: { ...kana.preferences.hermes, token: event.target.value } })} />
              </label>
            </div>
          </details>
        </div>
      </main>
    );
  }

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
        <button type="button" className={topActionIcon} onClick={() => { setHistoryOpen(true); }} aria-label="Open conversation history">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="3" width="13" height="11" rx="2"/><line x1="1.5" y1="6.5" x2="14.5" y2="6.5"/><line x1="5" y1="3" x2="5" y2="1.5"/><line x1="11" y1="3" x2="11" y2="1.5"/></svg>
        </button>
        <button type="button" className={topActionIcon} onClick={() => setSettingsOpen(true)} aria-label="Open settings">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Subtitle overlay — the latest assistant text or a "typing" indicator.
          Completely hidden when idle (no active turn, no recent subtitle). */}
      {latestAssistant?.subtitle?.text || kana.busy ? (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 w-[min(92%,720px)] -translate-x-1/2 text-center max-md:bottom-20">
          <div className="inline-block max-w-full rounded-xl border border-line bg-raised px-4 py-2">
            <p className={`font-jp text-lg leading-snug md:text-[22px] ${latestAssistant?.subtitle?.text ? "text-ink" : "animate-kana-pulse text-faint"}`}>
              {latestAssistant?.subtitle?.text ?? "Kana is listening…"}
            </p>
          </div>
          {latestAssistant?.subtitle ? (
            <span className="mt-1 inline-block rounded-full border border-line bg-raised px-2 py-px text-[9px] font-bold tracking-wider text-muted uppercase">
              {latestAssistant.subtitle.language.toUpperCase()}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Composer */}
      <div className="absolute bottom-5 left-1/2 z-20 w-[min(560px,calc(100%-32px))] -translate-x-1/2 max-md:bottom-3">
        <div className="relative">
          <ActivityStack activities={kana.activities} />
          <SlashCommandMenu
            suggestions={kana.commandSuggestions}
            loading={kana.commandSuggestionsLoading}
            selectedIndex={activeCommandIndex}
            onHighlight={highlightCommand}
            onSelect={selectCommand}
          />
          <div className="flex items-center rounded-full border border-line-strong bg-raised transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 max-md:h-10">
            <form className="contents" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <textarea
                id="kana-message"
                aria-label="Message Kana"
                ref={inputRef}
                value={message}
                aria-activedescendant={kana.commandSuggestions.length ? `kana-command-option-${activeCommandIndex}` : undefined}
                aria-controls={kana.commandSuggestions.length ? "kana-command-menu" : undefined}
                aria-autocomplete="list"
                onChange={(event) => { highlightCommand(0); setMessage(event.target.value); }}
                onKeyDown={onKeyDown}
                placeholder={connectionInTransition ? "Reconnecting…" : kana.busy ? "Use /approve, /deny…" : "Type a message…"}
                rows={1}
                className="max-h-22 min-h-10 flex-1 resize-none bg-transparent py-2 pl-4 pr-1 text-sm leading-relaxed text-ink caret-accent placeholder:text-faint focus:outline-none max-md:min-h-10 max-md:text-[13px]"
              />
            </form>
            <div className="flex flex-none items-center gap-1 pr-1.5">
              {kana.busy ? (
                <>
                  {canSubmitWhileBusy ? <button className="rounded-full bg-accent-dim px-3.5 py-1.5 text-xs font-bold text-on-accent transition-colors hover:bg-accent" type="button" onClick={() => void submit()}>Run</button> : null}
                  <button className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-dim transition-colors hover:bg-surface hover:text-danger" type="button" onClick={() => void kana.abort()}>
                    <span className="size-2 rounded-sm bg-current" /> Stop
                  </button>
                </>
              ) : (
                <button
                  className="grid size-8 place-items-center rounded-full bg-accent text-on-accent transition-transform hover:scale-105 active:scale-95 disabled:opacity-25 disabled:hover:scale-100"
                  type="button"
                  onClick={() => void submit()}
                  disabled={!message.trim() || connectionInTransition}
                  aria-label="Send message"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="size-4">
                    <path d="M2 8L14 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <path d="M9 3L14 8L9 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages panel (right drawer) */}
      <section
        className={`fixed inset-y-0 right-0 z-30 flex w-[min(420px,100vw)] flex-col border-l border-line bg-bg p-4 transition-transform duration-200 ${historyOpen ? "translate-x-0" : "translate-x-[102%]"}`}
        aria-label="Message history"
        aria-hidden={!historyOpen}
        inert={historyOpen ? undefined : true}
      >
        <header className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wider text-ink-dim uppercase">Messages</span>
          <button type="button" className={topActionIcon} aria-label="Close history" onClick={closeHistory}>×</button>
        </header>
        <DialogueHistory messages={kana.activeConversation?.messages ?? NO_MESSAGES} />
      </section>

      {/* Conversations panel (right drawer, layered above messages) */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-[min(340px,100vw)] border-l border-line bg-raised p-4 transition-transform duration-200 ${historyOpen ? "translate-x-0" : "translate-x-[102%]"}`}
        aria-hidden={!historyOpen}
        inert={historyOpen ? undefined : true}
      >
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
      </aside>

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
        <OnboardingDialog preferences={kana.preferences} onTestAgent={kana.testAgentConnection} onComplete={kana.savePreferences} />
      ) : null}
    </main>
  );
}
