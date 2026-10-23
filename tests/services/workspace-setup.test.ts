import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentConnectionState } from "@/lib/agent/types";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { selectShowGate, WorkspaceSetup } from "@/lib/services/workspace-setup";
import { createKanaStores } from "@/lib/store/kana-stores";

const RUNNING: HermesRuntimeStatus = {
  controlAvailable: true,
  state: "running",
  managed: false,
  executable: "/usr/bin/hermes",
  port: 9119,
  websocketUrl: "ws://127.0.0.1:9119/api/ws",
  tokenAvailable: true,
  message: "Hermes already running.",
};

const STOPPED: HermesRuntimeStatus = {
  ...RUNNING,
  state: "stopped",
  managed: false,
  tokenAvailable: false,
  message: "No running Hermes gateway was detected on this machine.",
};

function harness(options: {
  connectionState?: AgentConnectionState;
  runtime?: HermesRuntimeStatus | null;
  /** Answers for each immediate reconnect, in order. */
  reconnectResults?: boolean[];
  /** Replaces the relay connect call; the default reports a live connection. */
  connect?: () => Promise<void>;
  /** Replaces the runtime inspection; the default returns `runtime`. */
  inspect?: () => Promise<HermesRuntimeStatus>;
}) {
  const stores = createKanaStores();
  stores.agentSession.setState({ connectionState: options.connectionState ?? "disconnected" });
  stores.workspace.setState({ hermesRuntime: options.runtime ?? null });
  const calls = { connect: 0, reconnect: 0, start: 0 };
  const reconnectResults = [...(options.reconnectResults ?? [true])];
  const setup = new WorkspaceSetup({
    workspace: stores.workspace,
    agentSession: stores.agentSession,
    preferences: { current: () => ({ voiceEnabled: false }) } as never,
    hermesControl: {
      inspect: options.inspect ?? (async () => options.runtime ?? STOPPED),
      start: async () => {
        calls.start += 1;
        return RUNNING;
      },
      stop: async () => STOPPED,
    },
    inspectVoice: async () => ({ state: "ready" }) as never,
    connect: async () => {
      calls.connect += 1;
      if (options.connect) await options.connect();
      else stores.agentSession.setState({ connectionState: "connected" });
    },
    reconnect: async () => {
      calls.reconnect += 1;
      const connected = reconnectResults.shift() ?? false;
      if (connected) stores.agentSession.setState({ connectionState: "connected" });
      return connected;
    },
    fetchSetupState: async () => null,
    settle: async () => {},
  });
  return { stores, setup, calls };
}

describe("workspace setup manual connect", () => {
  it("retries at once during a live drop instead of waiting for the timer", async () => {
    const { stores, setup, calls } = harness({
      connectionState: "reconnecting",
      runtime: RUNNING,
      reconnectResults: [true],
    });

    await setup.connectHermes();

    assert.equal(calls.reconnect, 1);
    assert.equal(calls.connect, 0);
    assert.equal(calls.start, 0);
    assert.equal(stores.agentSession.getState().connectionState, "connected");
    assert.equal(stores.workspace.getState().connectPhase, "idle");
  });

  it("starts a managed Hermes that died during a live drop", async () => {
    const { stores, setup, calls } = harness({
      connectionState: "reconnecting",
      runtime: STOPPED,
      reconnectResults: [false, true],
    });

    await setup.connectHermes();

    assert.equal(calls.reconnect, 2);
    assert.equal(calls.start, 1);
    assert.equal(calls.connect, 0);
    assert.equal(stores.workspace.getState().hermesRuntime?.state, "running");
    assert.equal(stores.workspace.getState().connectPhase, "idle");
  });

  it("leaves the gate usable when the retry fails so another attempt can start Hermes", async () => {
    const { stores, setup, calls } = harness({
      connectionState: "reconnecting",
      runtime: { ...STOPPED, executable: undefined },
      reconnectResults: [false],
    });

    await setup.connectHermes();

    assert.equal(calls.reconnect, 1);
    assert.equal(calls.start, 0);
    // Idle, not a stuck transition: the button can be pressed again.
    assert.equal(stores.workspace.getState().connectPhase, "idle");
    assert.equal(stores.workspace.getState().hermesRuntimeBusy, false);
  });

  it("still connects from a disconnected first load", async () => {
    const { stores, setup, calls } = harness({
      connectionState: "disconnected",
      runtime: STOPPED,
      reconnectResults: [],
    });

    await setup.connectHermes();

    assert.equal(calls.connect, 1);
    assert.equal(calls.start, 0);
    // The automatic attempt owns the seating animation as much as the button.
    assert.equal(stores.workspace.getState().seatPending, true);
  });

  it("arms the seating animation for a live drop and its next success", async () => {
    const { stores, setup } = harness({
      connectionState: "connected",
      runtime: RUNNING,
    });
    await setup.startAfterReady();

    stores.agentSession.setState({ connectionState: "reconnecting" });
    assert.equal(stores.workspace.getState().seatPending, true);

    // The service only arms it; the gate clears it once the recording ends.
    stores.agentSession.setState({ connectionState: "connected" });
    assert.equal(stores.workspace.getState().seatPending, true);
  });

  it("starts Hermes after a failed attempt when an external gateway has stopped", async () => {
    const { stores, setup, calls } = harness({
      connectionState: "disconnected",
      // The stored snapshot says an external gateway is running, but it has no
      // token Kana could adopt and it is gone by the time the button runs.
      runtime: { ...RUNNING, managed: false, tokenAvailable: false },
      inspect: async () => STOPPED,
      connect: async () => {},
    });

    await setup.connectHermes();

    assert.equal(calls.start, 1);
    assert.equal(calls.connect, 2);
    assert.equal(stores.workspace.getState().hermesRuntime?.state, "running");
    assert.equal(stores.workspace.getState().connectPhase, "idle");
  });

  it("ignores a second attempt while one is running", async () => {
    let release: () => void = () => {};
    const { stores, setup, calls } = harness({
      connectionState: "disconnected",
      runtime: STOPPED,
      connect: () =>
        new Promise<void>((resolve) => {
          release = () => {
            stores.agentSession.setState({ connectionState: "connected" });
            resolve();
          };
        }),
    });

    const first = setup.connectHermes();
    const second = setup.connectHermes();
    await second;
    assert.equal(calls.connect, 1);
    release();
    await first;
  });
});

describe("connection gate visibility", () => {
  it("shows the gate from the first frame until the relay is connected", () => {
    for (const connectionState of [
      "idle",
      "disconnected",
      "connecting",
      "reconnecting",
      "error",
      "authentication_failed",
      "incompatible",
    ] as const) {
      assert.equal(
        selectShowGate({ ready: true, connectionState, wizardMode: null }),
        true,
        connectionState,
      );
    }
    assert.equal(
      selectShowGate({ ready: true, connectionState: "connected", wizardMode: null }),
      false,
    );
  });

  it("never covers the preparing screen or the setup wizard", () => {
    assert.equal(
      selectShowGate({ ready: false, connectionState: "disconnected", wizardMode: null }),
      false,
    );
    assert.equal(
      selectShowGate({ ready: true, connectionState: "disconnected", wizardMode: "full" }),
      false,
    );
  });
});

describe("runtime inspection ordering", () => {
  it("does not let a read that began before a start overwrite the start result", async () => {
    let release: (status: HermesRuntimeStatus) => void = () => {};
    const pendingRead = new Promise<HermesRuntimeStatus>((resolve) => {
      release = resolve;
    });
    const { stores, setup } = harness({ inspect: () => pendingRead });

    const read = setup.inspectForGate();
    await setup.startGateway();
    release({ ...STOPPED, message: "An older inspection landed late." });
    await read;

    assert.equal(stores.workspace.getState().hermesRuntime?.state, "running");
  });
});
