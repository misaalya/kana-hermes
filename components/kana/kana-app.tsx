"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentInputDialog } from "./agent-input-dialog";
import { AvatarLayoutControl } from "./avatar-layout-control";
import { AvatarLayoutSurface } from "./avatar-layout-surface";
import { AvatarStage } from "./avatar-stage";
import { ConversationSidebar } from "./conversation-sidebar";
import { LiveChatFeed } from "./live-chat-feed";
import { SettingsDialog } from "./settings-dialog";
import { SlashCommandMenu } from "./slash-command-menu";
import { ComposerDictation } from "./composer-dictation";
import { ComposerModelChoice } from "./composer-model-choice";
import {
  AttachmentUploadError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENTS,
  readAttachment,
  type AgentAttachment,
} from "@/lib/agent/attachments";
import { OnboardingWizard, type DependencyFindings } from "./onboarding-dialog";
import { useKanaController } from "@/lib/state/use-kana-controller";
import { useTheme } from "@/lib/state/use-theme";
import type { KanaMessage } from "@/lib/conversation/types";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import {
  fetchSetupState,
  markOnboardingComplete,
} from "@/lib/runtime/setup-client";
import { getCopy, type Copy } from "@/lib/ui/copy";

const MIB = 1024 * 1024;
import type { KanaPreferences } from "@/lib/preferences/types";
import { IndexedDbStageBackgroundStore } from "@/lib/background/indexed-db-stage-background-store";
import {
  live2DModelLayout,
  withLive2DModelLayout,
} from "@/lib/avatar/model-bindings";
import {
  DEFAULT_LIVE2D_MODEL_LAYOUT,
  type Live2DModelLayout,
} from "@/lib/avatar/model-layout";
import { btnPrimary } from "./ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  MoonIcon,
  PlusIcon,
  ReturnIcon,
  SettingsIcon,
  SunIcon,
} from "./icons";

function destructiveCommandPrompt(input: string, copy: Copy["workspace"]): string | null {
  const normalized = input.trim().toLowerCase().replace(/^\/+/, "");
  if (normalized === "new" || normalized.startsWith("new ")) return copy.confirmNew;
  if (normalized === "undo" || normalized.startsWith("undo ")) return copy.confirmUndo;
  if (normalized === "restart" || normalized.startsWith("restart ")) return copy.confirmRestart;
  if (normalized === "update" || normalized.startsWith("update ")) return copy.confirmUpdate;
  if (/^rollback\s+(restore|rewind)\b/.test(normalized)) return copy.confirmRollback;
  return null;
}

const NO_MESSAGES: KanaMessage[] = [];

type KanaAppProps = { appVersion: string };

export function KanaApp({ appVersion }: KanaAppProps) {
  const kana = useKanaController(appVersion);
  const voiceActive = ["synthesizing", "playing", "stopping"].includes(kana.voiceRuntimeState);
  const { theme, toggleTheme } = useTheme();
  const copy = getCopy(kana.preferences.uiLocale);
  const workspaceCopy = copy.workspace;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fileDrafts, setFileDrafts] = useState<Record<string, File[]>>({});
  const [composerNotice, setComposerNotice] = useState("");
  const [dictating, setDictating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [avatarLayoutOpen, setAvatarLayoutOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [usesMobileChat, setUsesMobileChat] = useState(false);
  const [customBackground, setCustomBackground] = useState<{
    id: string;
    url: string;
  }>();
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const automaticConnectStartedRef = useRef(false);
  const runtimeInspectionRef = useRef({
    connectionState: kana.connectionState,
    preferences: kana.preferences,
    inspectHermesControl: kana.inspectHermesControl,
    inspectVoiceService: kana.inspectVoiceService,
  });
  const stageBackgroundStore = useMemo(
    () => new IndexedDbStageBackgroundStore(),
    [],
  );
  const { clearCommandSuggestions } = kana;

  useEffect(() => {
    runtimeInspectionRef.current = {
      connectionState: kana.connectionState,
      preferences: kana.preferences,
      inspectHermesControl: kana.inspectHermesControl,
      inspectVoiceService: kana.inspectVoiceService,
    };
  });

  const inspectDependencyFindings = useCallback(async (): Promise<DependencyFindings> => {
    const current = runtimeInspectionRef.current;
    let hermes: DependencyFindings["hermes"] =
      current.connectionState === "connected" ? "running" : "installed";
    try {
      const status = await current.inspectHermesControl();
      setHermesRuntime(status);
      if (status.state === "running" || current.connectionState === "connected") {
        hermes = "running";
      } else {
        hermes = status.executable ? "installed" : "missing";
      }
    } catch {
      // A live Hermes relay is stronger evidence than the optional process
      // controller, particularly for externally managed VPS services.
      hermes = current.connectionState === "connected" ? "running" : "missing";
    }

    // Always inspect: the check is a cheap install lookup, and first-run setup
    // needs it before the voice preference is saved.
    let voice: DependencyFindings["voice"] = null;
    {
      try {
        const status = await current.inspectVoiceService();
        voice =
          status.state === "error"
            ? "error"
            : status.state === "loading"
              ? "loading"
              : status.state === "ready"
                ? "ok"
                : status.state === "unavailable"
                  ? status.installRequired
                    ? "not_installed"
                    : "unsupported"
                  : "stopped";
      } catch {
        voice = "error";
      }
    }
    const findings = { hermes, voice };
    setDeps(findings);
    return findings;
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const syncMobileChat = () => setUsesMobileChat(media.matches);
    syncMobileChat();
    media.addEventListener("change", syncMobileChat);
    return () => media.removeEventListener("change", syncMobileChat);
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    if (
      kana.preferences.stageBackground !== "custom"
      || !kana.preferences.customBackgroundId
    ) {
      return () => { active = false; };
    }
    void stageBackgroundStore.load(kana.preferences.customBackgroundId)
      .then((asset) => {
        if (!active || !asset) return;
        objectUrl = URL.createObjectURL(asset.content);
        setCustomBackground({ id: asset.id, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    kana.preferences.customBackgroundId,
    kana.preferences.stageBackground,
    stageBackgroundStore,
  ]);

  const importStageBackground = useCallback(
    (file: File) => stageBackgroundStore.import(file),
    [stageBackgroundStore],
  );
  const listStageBackgrounds = useCallback(
    () => stageBackgroundStore.list(),
    [stageBackgroundStore],
  );
  const loadStageBackground = useCallback(
    (id: string) => stageBackgroundStore.load(id),
    [stageBackgroundStore],
  );
  const deleteStageBackground = useCallback(
    (id: string) => stageBackgroundStore.delete(id),
    [stageBackgroundStore],
  );
  const currentPreferences = kana.preferences;
  const savePreferences = kana.savePreferences;
  const avatarLayout = live2DModelLayout(currentPreferences.live2d);
  const updateAvatarLayout = useCallback((layout: Live2DModelLayout) => {
    void savePreferences({
      ...currentPreferences,
      live2d: withLive2DModelLayout(currentPreferences.live2d, layout),
    });
  }, [currentPreferences, savePreferences]);
  // Latest-ref mirror: the typing effect below must fire only when the message
  // changes, not whenever controller identities churn between renders.
  const completeCommandsRef = useRef(kana.completeCommands);
  useEffect(() => {
    completeCommandsRef.current = kana.completeCommands;
  });

  const activeConversationId = kana.activeConversation?.id;
  const message = activeConversationId ? drafts[activeConversationId] ?? "" : "";
  const files = activeConversationId ? fileDrafts[activeConversationId] ?? [] : [];
  const setFiles = (next: File[]) => {
    if (activeConversationId) setFileDrafts((current) => ({ ...current, [activeConversationId]: next }));
  };
  const appendDictation = (text: string) => {
    if (activeConversationId) setDrafts((current) => ({ ...current, [activeConversationId]: [current[activeConversationId]?.trimEnd(), text].filter(Boolean).join(" ") }));
  };
  useEffect(() => { queueMicrotask(() => setComposerNotice("")); }, [activeConversationId]);
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
      const status = await kana.startHermesControl({ port: hermesRuntime?.port });
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

      const findings = await inspectDependencyFindings();
      if (!active) return;

      const degraded = findings.hermes === "missing" ||
        (findings.voice === "error" && runtimeInspectionRef.current.preferences.voiceEnabled);
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
  }, [inspectDependencyFindings, kana.ready]);

  // A voice engine download or a temporarily inaccessible process-control route
  // must not leave the repair banner frozen for the lifetime of the page.
  useEffect(() => {
    if (
      !kana.ready ||
      (deps.hermes !== "missing" && deps.voice !== "error")
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void inspectDependencyFindings();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [deps.hermes, deps.voice, inspectDependencyFindings, kana.ready]);

  const completeWizard = async (next: KanaPreferences) => {
    // Server flag first: it is the source other browsers read.
    await markOnboardingComplete();
    await kana.savePreferences({ ...next, onboardingCompleted: true });
    setWizardMode(null);
  };

  useEffect(() => {
    if (!message.startsWith("/")) { clearCommandSuggestions(); return; }
    const timer = window.setTimeout(() => { void completeCommandsRef.current(message); }, 120);
    return () => window.clearTimeout(timer);
  }, [clearCommandSuggestions, message]);

  const highlightCommand = useCallback((index: number) => {
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

  const submitMessage = async () => {
    const text = message.trim() || (files.length ? copy.composer.reviewAttachments : "");
    if (!text || submittingRef.current || dictating) return;
    if (files.length && (kana.busy || commandName)) {
      setComposerNotice(copy.composer.filesNeedRegularMessage);
      return;
    }
    // Prime Web Audio while Send/Enter still owns a browser user gesture.
    // The actual WAV arrives after Hermes and the voice engine finish, too late to unlock
    // autoplay on stricter mobile browsers.
    if (kana.preferences.voiceEnabled) kana.unlockVoice();
    const confirmation = destructiveCommandPrompt(text, workspaceCopy);
    if (confirmation && !window.confirm(confirmation)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setComposerNotice("");
    try {
      let attachments: AgentAttachment[];
      try {
        attachments = await Promise.all(files.map(readAttachment));
      } catch (error) {
        // Nothing reached the controller: keep the draft and the files.
        setComposerNotice(error instanceof Error ? error.message : copy.status.sendFailed);
        return;
      }
      try {
        const prefill = await kana.sendMessage(text, attachments);
        setMessage(prefill || "");
        setFiles([]);
      } catch (error) {
        if (error instanceof AttachmentUploadError) {
          // No prompt was submitted and the controller removed the user
          // message, so the draft stays for a retry.
          setComposerNotice(error.message);
        } else {
          // The user message is already in the conversation and the error
          // banner reports the failure; clear the draft so a retry cannot
          // duplicate the message.
          setMessage("");
          setFiles([]);
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!kana.ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <p className="text-[10px] font-bold tracking-[0.18em] text-muted uppercase animate-kana-pulse">{workspaceCopy.preparing}</p>
      </main>
    );
  }

  const gateCopy = copy.gate;
  const connectButtonLabel = connectionInTransition
    ? gateCopy.connecting
    : connectPhase === "auto_starting"
      ? gateCopy.startButton
      : gateCopy.connectButton;

  const gateFailed =
    kana.connectionState === "error" ||
    kana.connectionState === "authentication_failed" ||
    kana.connectionState === "incompatible";

  // Phones are chat-first: the avatar sits in a small call-style tile at the
  // top left. While the avatar is being positioned the chat steps aside and
  // the stage fills the screen so the whole model stays visible and draggable.
  const chatVisible = usesMobileChat ? !avatarLayoutOpen : chatOpen;
  const compactStage = usesMobileChat && !avatarLayoutOpen;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <AvatarStage
        avatar={kana.avatar}
        background={kana.preferences.stageBackground}
        customBackgroundUrl={
          customBackground
          && customBackground.id === kana.preferences.customBackgroundId
            ? customBackground.url
            : undefined
        }
        chatOpen={chatVisible}
        compact={compactStage}
        locale={kana.preferences.uiLocale}
        onCanvasReady={kana.attachAvatarCanvas}
      />

      {avatarLayoutOpen && kana.avatar.renderMode === "live2d" ? (
        <AvatarLayoutSurface
          layout={avatarLayout}
          label={copy.settings.avatarLayoutSurface}
          chatOpen={chatVisible}
          onChange={updateAvatarLayout}
        />
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 p-4 max-sm:p-3">
        {/* Phones and tablets use that corner for the avatar tile. */}
        <div className="pointer-events-auto min-w-0 max-lg:hidden">
          <p className="kana-session-title max-w-[34vw] truncate px-3 py-2 text-xs font-bold text-ink">
            {kana.activeConversation?.title ?? workspaceCopy.newMoment}
          </p>
        </div>

        <nav className="pointer-events-auto ml-auto flex items-center gap-2" aria-label={workspaceCopy.actions}>
          <button
            type="button"
            className="kana-workspace-action kana-focus"
            onClick={toggleTheme}
            aria-label={workspaceCopy.switchTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span className="max-sm:sr-only">{theme === "dark" ? workspaceCopy.light : workspaceCopy.dark}</span>
          </button>
          <AvatarLayoutControl
            layout={avatarLayout}
            copy={copy}
            open={avatarLayoutOpen}
            onOpenChange={setAvatarLayoutOpen}
            onChange={updateAvatarLayout}
            onReset={() => updateAvatarLayout({ ...DEFAULT_LIVE2D_MODEL_LAYOUT })}
          />
          <button
            type="button"
            className="kana-workspace-action kana-focus"
            onClick={() => {
              setAvatarLayoutOpen(false);
              setSessionsOpen(true);
            }}
            aria-label={workspaceCopy.openHistory}
          >
            <HistoryIcon />
            <span className="max-sm:sr-only">{workspaceCopy.history}</span>
          </button>
          <button
            type="button"
            className="kana-workspace-action kana-focus"
            onClick={() => {
              setAvatarLayoutOpen(false);
              setSettingsOpen(true);
            }}
            aria-label={workspaceCopy.openSettings}
          >
            <SettingsIcon />
            <span className="max-sm:sr-only">{workspaceCopy.settings}</span>
          </button>
        </nav>
      </header>

      <div className={`kana-chat-dock absolute bottom-4 right-4 top-[76px] z-10 w-[min(34vw,480px)] min-w-[390px] transition-transform duration-300 ease-out max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[var(--kana-compact-band)] max-lg:w-full max-lg:min-w-0 ${chatVisible ? "" : "is-closed"}`}>
        <button
          type="button"
          className="kana-chat-toggle absolute -left-12 top-1/2 z-20 h-28 w-12 -translate-y-1/2 text-accent hover:text-accent-hover max-lg:hidden"
          aria-controls="kana-chat-panel"
          aria-expanded={chatVisible}
          aria-label={chatVisible ? workspaceCopy.hideChat : workspaceCopy.showChat}
          onClick={() => setChatOpen((current) => !current)}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 48 112"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M48 0H27C22 0 19 2 16 6L5 20C2 24 1 28 1 33V79C1 84 2 88 5 92L16 106C19 110 22 112 27 112H48Z"
              fill="currentColor"
            />
          </svg>
          <span className="relative z-10 grid h-full place-items-center text-on-accent">
            {chatVisible ? <ChevronRightIcon className="size-5" /> : <ChevronLeftIcon className="size-5" />}
          </span>
        </button>

      <section
        id="kana-chat-panel"
        inert={chatVisible ? undefined : true}
        aria-hidden={!chatVisible}
        className="kana-chat-panel flex h-full w-full flex-col overflow-hidden rounded-[22px] max-lg:rounded-none"
      >
        <div className="flex min-h-0 flex-1">
          <LiveChatFeed
            messages={kana.activeConversation?.messages ?? NO_MESSAGES}
            activities={kana.activities}
            serverActivityTurns={kana.serverActivityTurns}
            busy={kana.busy || voiceActive}
            status={kana.status}
            locale={kana.preferences.uiLocale}
          />
        </div>
        <div className="kana-composer-shell shrink-0 border-t px-4 pb-3 pt-2.5 max-sm:px-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
          {kana.error ? (
            <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs">
              <p className="min-w-0 flex-1 break-words">{kana.error}</p>
              <button type="button" onClick={kana.clearError} className="kana-focus min-h-8 shrink-0 px-2"
                aria-label={copy.composer.dismissError}>
                ×
              </button>
            </div>
          ) : null}
          <div className="relative">
            <SlashCommandMenu
              suggestions={kana.commandSuggestions}
              loading={kana.commandSuggestionsLoading}
              selectedIndex={activeCommandIndex}
              onHighlight={highlightCommand}
              onSelect={selectCommand}
              locale={kana.preferences.uiLocale}
            />
            <div className="kana-composer flex flex-col">
              {files.length ? <ul aria-label={copy.composer.attachments} className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto py-1">
                {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1 rounded-lg bg-white/12 pl-2 text-[11px]">
                  <span className="truncate" title={file.name}>{file.name}</span>
                  <span className="shrink-0 opacity-70">{Math.ceil(file.size / 1024)} KB</span>
                  <button type="button" className="kana-focus size-8 shrink-0 rounded-lg hover:bg-white/12" disabled={submitting}
                    aria-label={copy.composer.remove(file.name)} onClick={() => setFiles(files.filter((_, selected) => selected !== index))}>×</button>
                </li>)}
              </ul> : null}
              <textarea
                id="kana-message"
                ref={inputRef}
                value={message}
                rows={1}
                readOnly={submitting}
                placeholder={workspaceCopy.messagePlaceholder}
                aria-label={workspaceCopy.messageAria}
                className="max-h-28 min-h-11 w-full resize-none bg-transparent px-1 py-3 text-[15px] leading-snug focus:outline-none"
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
              {composerNotice ? <p role="status" className="mb-1 px-1 text-[11px] leading-relaxed">{composerNotice}</p> : null}
              <div className="flex items-center gap-1">
              <input ref={fileInputRef} type="file" multiple className="hidden" aria-label={copy.composer.chooseFiles}
                onChange={(event) => {
                  const selected = [...files, ...Array.from(event.target.files ?? [])];
                  event.target.value = "";
                  if (selected.length > MAX_ATTACHMENTS || selected.some((file) => !file.size || file.size > MAX_ATTACHMENT_BYTES) || selected.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
                    setComposerNotice(copy.composer.attachmentLimits(MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES / MIB, MAX_ATTACHMENT_TOTAL_BYTES / MIB));
                    return;
                  }
                  setFiles(selected);
                  setComposerNotice("");
                  inputRef.current?.focus();
                }} />
              <button type="button" aria-label={copy.composer.attachFiles}
                title={copy.composer.attachFiles}
                disabled={submitting || !activeConversationId} className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/12 disabled:opacity-40"
                onClick={() => fileInputRef.current?.click()}><PlusIcon className="size-5" /></button>
              <ComposerDictation key={activeConversationId} locale={kana.preferences.uiLocale}
                disabled={submitting || kana.busy || voiceActive || !activeConversationId} onText={appendDictation} onActive={setDictating} onNotice={setComposerNotice} />
              <ComposerModelChoice key={`model-${activeConversationId}`} locale={kana.preferences.uiLocale} sessionKey={activeConversationId}
                connected={kana.connectionState === "connected"} disabled={kana.busy || submitting}
                onList={kana.listAgentModels} onSelect={kana.selectAgentModel} />
              {kana.busy || voiceActive ? (
                <button
                  type="button"
                  aria-label={workspaceCopy.stop}
                  className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20 hover:bg-white/30"
                  onClick={() => void kana.abort()}
                >
                  <span aria-hidden="true" className="size-3 rounded-xs bg-current" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={workspaceCopy.send}
                  disabled={(!message.trim() && !files.length) || submitting || dictating || (kana.busy && !canSubmitWhileBusy)}
                  className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void submitMessage()}
                >
                  <ReturnIcon className="size-[18px]" />
                </button>
              )}
              </div>
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* Session history modal */}
      {sessionsOpen ? (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-[var(--backdrop)] p-3 backdrop-blur-sm max-sm:p-0"
          role="dialog"
          aria-modal="true"
          aria-label={workspaceCopy.conversationHistory}
          onClick={closeSessions}
        >
          <section
            className="kana-settings-shell flex h-full w-[min(380px,100%)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-raised animate-kana-in max-sm:w-full max-sm:rounded-none max-sm:border-0"
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
              locale={kana.preferences.uiLocale}
            />
          </section>
        </div>
      ) : null}

      {showGate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[var(--backdrop)] p-4" role="dialog" aria-modal="true" aria-label={workspaceCopy.gatewayAria}>
          <div className="kana-panel flex w-full max-w-sm flex-col items-center rounded-2xl p-6 text-center animate-kana-in">
            <p className="text-[10px] font-bold tracking-[0.16em] text-muted uppercase">{workspaceCopy.gatewayEyebrow}</p>
            <h2 className="mt-1 text-lg font-bold text-ink">{workspaceCopy.gatewayTitle}</h2>
            <p className="mt-2 max-w-[290px] text-[11px] leading-relaxed text-muted">
              {workspaceCopy.gatewayBody}
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
              {workspaceCopy.notNow}
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
          onInspectAvatarModel={kana.inspectAvatarModel}
          onSelectAvatarModel={kana.selectAvatarModel}
          onRenameAvatarModel={kana.renameAvatarModel}
          onDeleteAvatarModel={kana.deleteAvatarModel}
          onImportStageBackground={importStageBackground}
          onListStageBackgrounds={listStageBackgrounds}
          onLoadStageBackground={loadStageBackground}
          onDeleteStageBackground={deleteStageBackground}
          onInspectHermesControl={kana.inspectHermesControl}
          onStartHermesControl={kana.startHermesControl}
          onStopHermesControl={kana.stopHermesControl}
          onListAgentModels={kana.listAgentModels}
          onSelectAgentModel={kana.selectAgentModel}
          onPreviewAvatarEmotion={kana.previewAvatarEmotion}
          onPreviewAvatarTalking={kana.previewAvatarTalking}
          onClose={() => {
            setSettingsOpen(false);
            void inspectDependencyFindings();
          }}
        />
      ) : null}

      {kana.pendingInput ? (
        <AgentInputDialog
          key={kana.pendingInput.kind === "approval" ? `approval-${kana.pendingInput.command}` : `${kana.pendingInput.kind}-${kana.pendingInput.requestId}`}
          request={kana.pendingInput}
          submitting={kana.respondingToInput}
          onRespond={kana.respondToInput}
          locale={kana.preferences.uiLocale}
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

      {!wizardMode && (deps.hermes === "missing" || (deps.voice === "error" && kana.preferences.voiceEnabled)) ? (
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
    <div className="kana-panel kana-degraded-banner absolute bottom-5 left-5 z-20 flex max-w-[360px] items-center gap-3 rounded-md px-3.5 py-2.5">
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
