import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { restartManagedHermesForModelChange } from "@/lib/services/model-change-restart";

type Probe = {
  mode: "local" | "remote";
  state: "disabled" | "stopped" | "starting" | "running" | "stopping" | "failed";
  managed: boolean;
  controlAvailable: boolean;
};

const RUNNING: Probe = {
  mode: "local",
  state: "running",
  managed: true,
  controlAvailable: true,
};

function harness(probe: Probe = RUNNING, options: {
  busy?: boolean;
  inspectError?: Error;
  restartError?: Error;
  reconnected?: boolean;
} = {}) {
  const calls = { inspect: 0, restart: 0, reconnect: 0 };
  return {
    calls,
    run: () => restartManagedHermesForModelChange({
      busy: options.busy ?? false,
      async inspect() {
        calls.inspect += 1;
        if (options.inspectError) throw options.inspectError;
        return probe;
      },
      async restart() {
        calls.restart += 1;
        if (options.restartError) throw options.restartError;
      },
      async reconnect() {
        calls.reconnect += 1;
        return options.reconnected ?? true;
      },
    }),
  };
}

describe("restartManagedHermesForModelChange", () => {
  it("does nothing while a Hermes turn is running", async () => {
    const test = harness(RUNNING, { busy: true });
    assert.deepEqual(await test.run(), { status: "busy" });
    assert.deepEqual(test.calls, { inspect: 0, restart: 0, reconnect: 0 });
  });

  it("leaves a remote Hermes alone", async () => {
    const test = harness({ ...RUNNING, mode: "remote", managed: false, controlAvailable: false });
    assert.deepEqual(await test.run(), { status: "remote" });
    assert.equal(test.calls.restart, 0);
  });

  it("reports process control that the launcher did not provide", async () => {
    const test = harness({ ...RUNNING, state: "disabled", managed: false, controlAvailable: false });
    assert.deepEqual(await test.run(), { status: "not-managed" });
    assert.equal(test.calls.restart, 0);
  });

  it("does not start a stopped Hermes just to apply a save", async () => {
    const test = harness({ ...RUNNING, state: "stopped", managed: false });
    assert.deepEqual(await test.run(), { status: "not-running" });
    assert.equal(test.calls.restart, 0);
  });

  it("leaves an adopted Hermes that Kana did not start alone", async () => {
    const test = harness({ ...RUNNING, managed: false });
    assert.deepEqual(await test.run(), { status: "not-managed" });
    assert.equal(test.calls.restart, 0);
  });

  it("restarts the managed Hermes and waits for the reconnect", async () => {
    const test = harness();
    assert.deepEqual(await test.run(), { status: "restarted" });
    assert.deepEqual(test.calls, { inspect: 1, restart: 1, reconnect: 1 });
  });

  it("reports a restart whose reconnect is still running", async () => {
    const test = harness(RUNNING, { reconnected: false });
    assert.deepEqual(await test.run(), { status: "reconnecting" });
    assert.equal(test.calls.restart, 1);
  });

  it("returns the failure when the runtime cannot be inspected", async () => {
    const test = harness(RUNNING, { inspectError: new Error("control unavailable") });
    assert.deepEqual(await test.run(), {
      status: "failed",
      message: "control unavailable",
    });
    assert.equal(test.calls.restart, 0);
  });

  it("returns the failure when the restart rejects", async () => {
    const test = harness(RUNNING, { restartError: new Error("process exited") });
    assert.deepEqual(await test.run(), {
      status: "failed",
      message: "process exited",
    });
    assert.equal(test.calls.reconnect, 0);
  });
});
