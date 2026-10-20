import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentConnectionState } from "@/lib/agent/types";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { WorkspaceSetup } from "@/lib/services/workspace-setup";
import { createKanaStores } from "@/lib/store/kana-stores";

const RUNNING: HermesRuntimeStatus = {
  controlAvailable: true,
  state: "running",
  managed: false,
  executable: "/usr/bin/hermes",
  port: 9119,
  websocketUrl: "ws://127.0.0.1:9119/api/ws",
  message: "Hermes already running.",
};

const STOPPED: HermesRuntimeStatus = {
  ...RUNNING,
  state: "stopped",
  managed: false,
  message: "No running Hermes gateway was detected on this machine.",
};

function harness(options: {
  connectionState?: AgentConnectionState;
  runtime?: HermesRuntimeStatus | null;
  /** Answers for each immediate reconnect, in order. */
  reconnectResults?: boolean[];
  /** Replaces the relay connect call; the default reports a live connection. */
  connect?: () => Promise<void>;
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
      inspect: async () => options.runtime ?? STOPPED,
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
    assert.equal(stores.workspace.getState().connectionGateOpen, false);
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
    assert.equal(stores.workspace.getState().connectionGateOpen, false);
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
    assert.equal(stores.workspace.getState().connectionGateOpen, true);
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
    assert.equal(stores.workspace.getState().connectionGateOpen, false);
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
