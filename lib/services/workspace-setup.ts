import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { SetupState } from "@/lib/runtime/setup-client";
import type { AgentSessionStore } from "@/lib/store/agent-session-store";
import type { DependencyFindings, WizardMode, WorkspaceStore } from "@/lib/store/workspace-store";
import type { VoiceProviderStatus } from "@/lib/voice/types";
import type { PreferencesAccess } from "./preferences-service";

export const REPAIR_PROMPT_SEEN_KEY = "kana.repairPrompt.seen";

export type HermesControl = {
  inspect(preferredPort?: number): Promise<HermesRuntimeStatus>;
  start(options?: { port?: number; restart?: boolean }): Promise<HermesRuntimeStatus>;
  stop(): Promise<HermesRuntimeStatus>;
};

export type WorkspaceSetupDependencies = {
  workspace: WorkspaceStore;
  agentSession: AgentSessionStore;
  preferences: PreferencesAccess;
  hermesControl: HermesControl;
  inspectVoice(): Promise<VoiceProviderStatus>;
  connect(): Promise<void>;
  fetchSetupState(): Promise<SetupState | null>;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  /** Let the connection-state update from connect() settle before reading it. */
  settle(ms: number): Promise<void>;
};

export function voiceFinding(status: VoiceProviderStatus): DependencyFindings["voice"] {
  switch (status.state) {
    case "error":
      return "error";
    case "loading":
      return "loading";
    case "ready":
      return "ok";
    case "unavailable":
      return status.installRequired ? "not_installed" : "unsupported";
    default:
      return "stopped";
  }
}

/**
 * Connection gate, dependency checks, and the setup wizard. Each page load
 * makes one automatic connection attempt; the gate appears only after that
 * attempt genuinely fails.
 */
export class WorkspaceSetup {
  private automaticConnectStarted = false;
  private active = true;
  private repairTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeDeps: (() => void) | null = null;

  constructor(private readonly deps: WorkspaceSetupDependencies) {}

  private get store() {
    return this.deps.workspace;
  }

  private connected(): boolean {
    return this.deps.agentSession.getState().connectionState === "connected";
  }

  async inspectDependencies(): Promise<DependencyFindings> {
    const connected = this.connected();
    let hermes: DependencyFindings["hermes"] = connected ? "running" : "installed";
    try {
      const status = await this.deps.hermesControl.inspect();
      this.store.setState({ hermesRuntime: status });
      hermes = status.state === "running" || this.connected() ? "running" : status.executable ? "installed" : "missing";
    } catch {
      // A live relay is stronger evidence than the optional process controller,
      // particularly for externally managed VPS services.
      hermes = this.connected() ? "running" : "missing";
    }

    // Always inspect: the check is a cheap install lookup, and first-run setup
    // needs it before the voice preference is saved.
    let voice: DependencyFindings["voice"];
    try {
      voice = voiceFinding(await this.deps.inspectVoice());
    } catch {
      voice = "error";
    }
    const findings = { hermes, voice };
    this.store.setState({ deps: findings });
    return findings;
  }

  async startGateway(): Promise<void> {
    this.store.setState({ hermesRuntimeBusy: true, hermesRuntimeNotice: null });
    try {
      const status = await this.deps.hermesControl.start({ port: this.store.getState().hermesRuntime?.port });
      this.store.setState({ hermesRuntime: status, hermesRuntimeNotice: status.message });
      await this.deps.connect();
    } catch (error) {
      this.store.setState({
        hermesRuntimeNotice: error instanceof Error ? error.message : "Could not start the Hermes gateway.",
      });
      try {
        this.store.setState({ hermesRuntime: await this.deps.hermesControl.inspect() });
      } catch {}
    } finally {
      this.store.setState({ hermesRuntimeBusy: false });
    }
  }

  /** Connect through the relay; start the managed gateway when Hermes is installed but not running. */
  async connectHermes(): Promise<void> {
    const connectionState = this.deps.agentSession.getState().connectionState;
    if (connectionState === "connecting" || connectionState === "reconnecting") return;
    this.store.setState({ connectionGateDismissed: false, connectPhase: "connecting", hermesRuntimeNotice: null });

    // The server may already run Hermes.
    await this.deps.connect();
    await this.deps.settle(0);
    if (this.connected()) {
      this.store.setState({ automaticConnectFinished: true, connectionGateOpen: false, connectPhase: "idle" });
      return;
    }

    let runtime = this.store.getState().hermesRuntime;
    if (!runtime) {
      try {
        runtime = await this.deps.hermesControl.inspect();
        this.store.setState({ hermesRuntime: runtime });
      } catch {
        runtime = null;
      }
    }
    if (runtime?.executable && runtime.state !== "running") {
      this.store.setState({ connectPhase: "auto_starting" });
      try {
        await this.startGateway();
        await this.deps.settle(100);
        await this.deps.connect();
      } catch {
        // The gate below reports the outcome.
      }
    }
    await this.deps.settle(0);
    this.store.setState({
      connectionGateOpen: !this.connected(),
      automaticConnectFinished: true,
      connectPhase: "idle",
    });
  }

  dismissGate(): void {
    this.store.setState({ connectionGateOpen: false, connectionGateDismissed: true });
  }

  /** Refresh the runtime status shown inside the gate. */
  async inspectForGate(): Promise<void> {
    try {
      const status = await this.deps.hermesControl.inspect();
      if (this.active) this.store.setState({ hermesRuntime: status });
    } catch {
      if (this.active) this.store.setState({ hermesRuntime: null });
    }
  }

  /**
   * Run once the workspace is ready: the automatic connection and the setup
   * wizard. The full wizard follows the server-side flag (once per
   * installation); a repair run opens at most once per browser session.
   */
  async startAfterReady(): Promise<void> {
    this.active = true;
    this.watchRepairs();
    if (!this.automaticConnectStarted) {
      this.automaticConnectStarted = true;
      void this.connectHermes();
    }
    const state = await this.deps.fetchSetupState();
    if (!this.active) return;
    const findings = await this.inspectDependencies();
    if (!this.active) return;

    const degraded =
      findings.hermes === "missing" || (findings.voice === "error" && this.deps.preferences.current().voiceEnabled);
    const storage = this.deps.sessionStorage;
    if (state && !state.onboardingCompleted) {
      this.store.setState({ wizardMode: "full" });
    } else if (degraded && state?.onboardingCompleted !== false && storage && !storage.getItem(REPAIR_PROMPT_SEEN_KEY)) {
      storage.setItem(REPAIR_PROMPT_SEEN_KEY, "1");
      this.store.setState({ wizardMode: "repair" });
    }
  }

  stop(): void {
    this.active = false;
    this.unsubscribeDeps?.();
    this.unsubscribeDeps = null;
    this.setRepairPolling(false);
  }

  /**
   * While a dependency is unhealthy, check again every 10 seconds so a voice
   * download or a briefly unreachable control route cannot freeze the banner.
   */
  private watchRepairs(): void {
    if (this.unsubscribeDeps) return;
    const sync = () => {
      const { deps } = this.store.getState();
      this.setRepairPolling(deps.hermes === "missing" || deps.voice === "error");
    };
    sync();
    this.unsubscribeDeps = this.store.subscribe((state, previous) => {
      if (state.deps !== previous.deps) sync();
    });
  }

  private setRepairPolling(enabled: boolean): void {
    if (enabled && !this.repairTimer) {
      this.repairTimer = setInterval(() => void this.inspectDependencies(), 10_000);
    } else if (!enabled && this.repairTimer) {
      clearInterval(this.repairTimer);
      this.repairTimer = null;
    }
  }
}

export function selectShowGate(input: {
  ready: boolean;
  connectionState: string;
  wizardMode: WizardMode;
  connectionGateOpen: boolean;
  connectionGateDismissed: boolean;
  automaticConnectFinished: boolean;
}): boolean {
  const failed =
    input.connectionState === "error" ||
    input.connectionState === "authentication_failed" ||
    input.connectionState === "incompatible";
  return (
    input.ready &&
    !input.wizardMode &&
    (input.connectionGateOpen || (!input.connectionGateDismissed && input.automaticConnectFinished && failed)) &&
    input.connectionState !== "connected"
  );
}
