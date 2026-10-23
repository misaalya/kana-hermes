import type { AgentConnectionState } from "@/lib/agent/types";
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
  /** Try the connection now instead of after the scheduled reconnect delay. */
  reconnect(): Promise<boolean>;
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
 * makes one automatic connection attempt. The gate follows the connection
 * from the first frame: it is on screen for that attempt and every retry,
 * including a live drop Kana is still recovering from.
 */
export class WorkspaceSetup {
  private automaticConnectStarted = false;
  private active = true;
  private repairTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeDeps: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  /** Orders runtime reads against a start, which is authoritative when it lands. */
  private runtimeSequence = 0;
  private runtimeApplied = 0;

  constructor(private readonly deps: WorkspaceSetupDependencies) {}

  private get store() {
    return this.deps.workspace;
  }

  private connected(): boolean {
    return this.deps.agentSession.getState().connectionState === "connected";
  }

  /**
   * Read the runtime without letting a slower, older read overwrite a newer
   * one or a start result. A live relay or a successful start is the truth.
   */
  private async refreshRuntime(): Promise<HermesRuntimeStatus | null> {
    const sequence = ++this.runtimeSequence;
    try {
      const status = await this.deps.hermesControl.inspect();
      if (this.active && sequence > this.runtimeApplied) {
        this.runtimeApplied = sequence;
        this.store.setState({ hermesRuntime: status });
      }
      return status;
    } catch {
      if (this.active && sequence > this.runtimeApplied) {
        this.runtimeApplied = sequence;
        this.store.setState({ hermesRuntime: null });
      }
      return null;
    }
  }

  private applyRuntime(status: HermesRuntimeStatus): void {
    this.runtimeSequence += 1;
    this.runtimeApplied = this.runtimeSequence;
    this.store.setState({ hermesRuntime: status });
  }

  async inspectDependencies(): Promise<DependencyFindings> {
    const status = await this.refreshRuntime();
    // A live relay is stronger evidence than the optional process controller,
    // particularly for externally managed VPS services.
    const hermes: DependencyFindings["hermes"] =
      this.connected() || status?.state === "running"
        ? "running"
        : status?.executable
          ? "installed"
          : "missing";

    // Always inspect: the check is a cheap install lookup, and first-run setup
    // needs it before the voice preference is saved.
    let voice: DependencyFindings["voice"];
    try {
      voice = voiceFinding(await this.deps.inspectVoice());
    } catch {
      voice = "error";
    }
    const findings = { hermes, voice };
    if (this.active) this.store.setState({ deps: findings });
    return findings;
  }

  /** Start the managed gateway and report the outcome; the caller connects. */
  async startGateway(): Promise<void> {
    this.store.setState({ hermesRuntimeBusy: true, hermesRuntimeNotice: null });
    try {
      const status = await this.deps.hermesControl.start({ port: this.store.getState().hermesRuntime?.port });
      this.applyRuntime(status);
    } catch (error) {
      this.store.setState({
        hermesRuntimeNotice: error instanceof Error ? error.message : "Could not start the Hermes gateway.",
      });
      await this.refreshRuntime();
    } finally {
      this.store.setState({ hermesRuntimeBusy: false });
    }
  }

  /** End the attempt once the connection is up. */
  private finishConnection(): void {
    this.store.setState({ connectPhase: "idle" });
  }

  /**
   * Connect through the relay; start the managed gateway when Hermes is
   * installed but not running. A live drop is retried on a timer, so a manual
   * attempt during it tries now instead of waiting, and can start Hermes.
   */
  async connectHermes(): Promise<void> {
    const connectionState = this.deps.agentSession.getState().connectionState;
    // One attempt owns the gate: the auto-connect and the button must not race.
    if (connectionState === "connecting" || this.store.getState().connectPhase !== "idle") return;
    const reconnecting = connectionState === "reconnecting";
    this.store.setState({ connectPhase: "connecting", hermesRuntimeNotice: null, seatPending: true });

    // A scheduled retry is waiting; ask for the connection now.
    if (reconnecting && (await this.deps.reconnect())) {
      this.finishConnection();
      return;
    }

    // The server may already run Hermes.
    if (!reconnecting) {
      await this.deps.connect();
      await this.deps.settle(0);
      if (this.connected()) {
        this.finishConnection();
        return;
      }
    }

    // A failed attempt can change the runtime: an adopted gateway may have
    // been stopped, or Kana's own child may have died, while the relay was
    // unreachable. A snapshot from before the attempt cannot decide whether
    // Kana should start Hermes now.
    const runtime = await this.refreshRuntime();
    if (runtime?.executable && runtime.state !== "running") {
      this.store.setState({ connectPhase: "auto_starting" });
      try {
        await this.startGateway();
        await this.deps.settle(100);
        if (reconnecting) await this.deps.reconnect();
        else await this.deps.connect();
      } catch {
        // The gate below reports the outcome.
      }
    }
    await this.deps.settle(0);
    this.store.setState({ connectPhase: "idle" });
  }

  /** Refresh the runtime status shown inside the gate. */
  async inspectForGate(): Promise<void> {
    if (!this.active) return;
    await this.refreshRuntime();
  }

  /**
   * Run once the workspace is ready: the automatic connection and the setup
   * wizard. The full wizard follows the server-side flag (once per
   * installation); a repair run opens at most once per browser session.
   */
  async startAfterReady(): Promise<void> {
    this.active = true;
    this.watchRepairs();
    this.watchConnection();
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
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.setRepairPolling(false);
  }

  /**
   * A drop arms the gate's seating animation too: a retry that succeeds on the
   * timer, without a button press, still seats the cable before the workspace
   * returns.
   */
  private watchConnection(): void {
    if (this.unsubscribeConnection) return;
    this.unsubscribeConnection = this.deps.agentSession.subscribe((state, previous) => {
      if (state.connectionState === previous.connectionState) return;
      if (state.connectionState !== "connected") this.store.setState({ seatPending: true });
    });
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
  connectionState: AgentConnectionState;
  wizardMode: WizardMode;
}): boolean {
  // From the first automatic attempt through every retry, an unreachable
  // Hermes leaves the workspace with nothing to show: the gate owns the state
  // and the cable animation for as long as the relay is not connected.
  return input.ready && !input.wizardMode && input.connectionState !== "connected";
}
