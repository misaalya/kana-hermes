import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HermesAgentClient } from "@/lib/agent/hermes/hermes-agent-client";
import type { AgentEvent } from "@/lib/agent/types";

type RpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type RpcHandler = (request: RpcRequest) => unknown | Promise<unknown>;

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static handler: RpcHandler = () => ({});

  readonly url: string;
  readonly requests: RpcRequest[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      this.emitFrame({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      });
    });
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as RpcRequest;
    this.requests.push(request);
    void Promise.resolve(FakeWebSocket.handler(request)).then(
      (result) =>
        this.emitFrame({ jsonrpc: "2.0", id: request.id, result }),
      (error) =>
        this.emitFrame({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    );
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event("close");
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    });
    this.dispatchEvent(event);
  }

  unexpectedClose(code = 1006, reason = "connection lost"): void {
    this.close(code, reason);
  }

  emitEvent(
    type: string,
    payload: Record<string, unknown> = {},
    sessionId = "runtime-1",
  ): void {
    this.emitFrame({
      jsonrpc: "2.0",
      method: "event",
      params: { type, session_id: sessionId, payload },
    });
  }

  private emitFrame(frame: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalWindow = globalThis.window;

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

function restoreBrowserGlobals(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: originalWebSocket,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  assert.ok(socket);
  return socket;
}

function responseText(language = "en"): string {
  return JSON.stringify({
    speech_ja: "こんにちは。",
    subtitle: { text: "Hello.", language },
    emotion: "happy",
  });
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let activeClients: HermesAgentClient[] = [];

async function connectedClient(handler: RpcHandler): Promise<HermesAgentClient> {
  FakeWebSocket.handler = handler;
  const client = new HermesAgentClient({
    websocketUrl: "ws://127.0.0.1:9121/api/ws",
    token: "test-token",
    requestTimeoutMs: 500,
  });
  activeClients.push(client);
  await client.connect();
  return client;
}

async function openSession(client: HermesAgentClient): Promise<void> {
  await client.openSession({ title: "Test", subtitleLanguage: "en" });
}

describe("HermesAgentClient", () => {
  beforeEach(() => {
    installBrowserGlobals();
    FakeWebSocket.instances = [];
    FakeWebSocket.handler = () => ({});
    activeClients = [];
  });

  afterEach(async () => {
    await Promise.all(activeClients.map((client) => client.disconnect()));
    for (const socket of FakeWebSocket.instances) socket.close();
    restoreBrowserGlobals();
  });

  it("connects with the token and creates a Kana-scoped session", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "session.resume") {
        return {
          session_id: "runtime-2",
          session_key: "stored-1",
          resumed: "stored-1",
          running: false,
          messages: [],
        };
      }
      return {};
    });

    const session = await client.openSession({
      title: "Kana audit",
      subtitleLanguage: "id",
      cwd: "/tmp/project",
    });

    assert.deepEqual(session, {
      sessionId: "runtime-1",
      persistentSessionId: "stored-1",
      resumed: false,
    });
    assert.match(latestSocket().url, /token=test-token/);
    const create = latestSocket().requests.find(
      (request) => request.method === "session.create",
    );
    assert.ok(create);
    assert.equal(create.params.source, "kana");
    assert.equal(create.params.close_on_disconnect, false);
    assert.equal(create.params.cwd, "/tmp/project");
    assert.match(JSON.stringify(create.params.messages), /speech_ja/);
    assert.match(JSON.stringify(create.params.messages), /subtitle/);
  });

  it("uses the live catalog and marks surface-only commands honestly", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "commands.catalog") {
        return {
          categories: [
            {
              name: "Configuration",
              pairs: [
                ["/reasoning", "Reasoning controls"],
                ["/voice", "Messaging voice controls"],
              ],
            },
          ],
          pairs: [["/custom-skill", "Installed skill"]],
          skills: { "/custom-skill": { origin: "local" } },
        };
      }
      if (request.method === "complete.slash") {
        return {
          replace_from: 11,
          items: [{ text: "high", display: "high", meta: "More reasoning" }],
        };
      }
      return {};
    });

    const catalog = await client.completeCommands("/");
    assert.equal(catalog.length, 3);
    assert.equal(
      catalog.find((item) => item.text === "/voice")?.availability,
      "unavailable",
    );
    assert.equal(
      catalog.find((item) => item.text === "/custom-skill")?.kind,
      "skill",
    );

    const argumentsList = await client.completeCommands("/reasoning h");
    assert.equal(argumentsList[0]?.text, "/reasoning high");
  });

  it("resolves aliases, prefills, and fallback command dispatch", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "slash.exec") {
        const command = String(request.params.command);
        if (command === "alias-name value") return { type: "alias", target: "real-name" };
        if (command === "real-name value") return { type: "exec", output: "resolved" };
        if (command === "undo") {
          return { type: "prefill", message: "previous prompt", notice: "Undone" };
        }
        throw new Error("worker unavailable");
      }
      if (request.method === "command.dispatch") {
        return { type: "plugin", output: "plugin fallback" };
      }
      return {};
    });
    await openSession(client);

    assert.deepEqual(
      await client.executeCommand({ command: "/alias-name value", subtitleLanguage: "en" }),
      { type: "output", output: "resolved" },
    );
    assert.deepEqual(
      await client.executeCommand({ command: "/undo", subtitleLanguage: "en" }),
      { type: "prefill", message: "previous prompt", notice: "Undone" },
    );
    assert.deepEqual(
      await client.executeCommand({ command: "/plugin-x", subtitleLanguage: "en" }),
      { type: "output", output: "plugin fallback" },
    );
  });

  it("queues send directives and drains them after finish or interrupt", async () => {
    let promptCount = 0;
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "prompt.submit") {
        promptCount += 1;
        return { accepted: true };
      }
      if (request.method === "slash.exec") {
        return { type: "send", message: "goal kickoff", notice: "Goal set" };
      }
      return {};
    });
    await openSession(client);

    await client.sendMessage({ text: "first", subtitleLanguage: "en" });
    assert.equal(promptCount, 1);
    assert.deepEqual(
      await client.executeCommand({ command: "/goal build it", subtitleLanguage: "en" }),
      { type: "output", output: "Goal set" },
    );
    latestSocket().emitEvent("message.complete", {
      status: "complete",
      text: responseText(),
    });
    await tick();
    assert.equal(promptCount, 2);

    await client.executeCommand({ command: "/goal continue", subtitleLanguage: "en" });
    latestSocket().emitEvent("message.complete", { status: "interrupted" });
    await tick();
    assert.equal(promptCount, 3);
  });

  it("uses dedicated approval, title, branch, secure input, and interrupt RPCs", async () => {
    const calls: RpcRequest[] = [];
    const client = await connectedClient((request) => {
      calls.push(request);
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "approval.respond") return { resolved: true };
      if (request.method === "session.title") return { title: "Renamed" };
      if (request.method === "session.branch") {
        return {
          session_id: "runtime-branch",
          stored_session_id: "stored-branch",
          title: "Branch",
        };
      }
      if (request.method === "session.save") return { file: "/tmp/session.json" };
      if (request.method === "session.status") return { output: "Hermes status" };
      if (request.method === "session.compress") {
        return { status: "compressed", removed: 4 };
      }
      if (request.method === "session.steer") return { status: "queued" };
      if (request.method === "handoff.request") {
        return { queued: true, platform: "telegram", home_name: "Nobu" };
      }
      return {};
    });
    await openSession(client);

    await client.executeCommand({ command: "/approve always all", subtitleLanguage: "en" });
    await client.executeCommand({ command: "/title Renamed", subtitleLanguage: "en" });
    const branch = await client.executeCommand({
      command: "/branch Branch",
      subtitleLanguage: "en",
    });
    assert.equal(branch.type, "session");
    assert.equal(
      (
        await client.executeCommand({ command: "/save", subtitleLanguage: "en" })
      ).type,
      "output",
    );
    await client.executeCommand({ command: "/status", subtitleLanguage: "en" });
    await client.executeCommand({ command: "/compress focus", subtitleLanguage: "en" });
    await client.executeCommand({ command: "/steer correct this", subtitleLanguage: "en" });
    await client.executeCommand({ command: "/handoff telegram", subtitleLanguage: "en" });
    await client.respondToInput({
      kind: "clarification",
      requestId: "clarify-1",
      answer: "Use option A",
    });
    await client.respondToInput({ kind: "sudo", requestId: "sudo-1", password: "secret" });
    await client.respondToInput({ kind: "secret", requestId: "secret-1", value: "token" });
    await client.abort();

    assert.deepEqual(
      calls.find((request) => request.method === "approval.respond")?.params,
      { session_id: "runtime-1", choice: "always", all: true },
    );
    assert.ok(calls.some((request) => request.method === "clarify.respond"));
    assert.ok(calls.some((request) => request.method === "sudo.respond"));
    assert.ok(calls.some((request) => request.method === "secret.respond"));
    assert.ok(calls.some((request) => request.method === "session.save"));
    assert.ok(calls.some((request) => request.method === "session.status"));
    assert.ok(calls.some((request) => request.method === "session.compress"));
    assert.ok(calls.some((request) => request.method === "session.steer"));
    assert.ok(calls.some((request) => request.method === "handoff.request"));
    assert.deepEqual(
      calls.find((request) => request.method === "session.interrupt")?.params,
      { session_id: "runtime-branch" },
    );
  });

  it("translates input and tool events and reconnects after an unexpected close", async () => {
    const events: AgentEvent[] = [];
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "session.resume") {
        return {
          session_id: "runtime-2",
          session_key: "stored-1",
          resumed: "stored-1",
          running: false,
          messages: [],
        };
      }
      return {};
    });
    await openSession(client);
    client.subscribe((event) => events.push(event));

    latestSocket().emitEvent("clarify.request", {
      request_id: "clarify-1",
      question: "Which option?",
      choices: ["A", "B"],
    });
    latestSocket().emitEvent("tool.start", {
      tool_id: "tool-1",
      name: "terminal",
      args: { command: "pwd" },
    });
    latestSocket().emitEvent("tool.complete", {
      tool_id: "tool-1",
      name: "terminal",
      result: "done",
      duration_s: 0.25,
    });
    assert.ok(events.some((event) => event.type === "input.requested"));
    assert.ok(events.some((event) => event.type === "tool.started"));
    assert.ok(events.some((event) => event.type === "tool.finished"));

    latestSocket().unexpectedClose();
    assert.equal(client.connectionState, "reconnecting");
    await client.connect();
    assert.equal(client.connectionState, "connected");
    assert.equal(FakeWebSocket.instances.length, 2);
    const resumed = await client.openSession({
      persistentSessionId: "stored-1",
      subtitleLanguage: "en",
    });
    assert.equal(resumed.sessionId, "runtime-2");
    assert.ok(latestSocket().requests.some((request) => request.method === "session.resume"));
  });

  it("handles delayed, duplicate, out-of-order, foreign-session, and error events deterministically", async () => {
    const events: AgentEvent[] = [];
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "prompt.submit") return { accepted: true };
      return {};
    });
    await openSession(client);
    client.subscribe((event) => events.push(event));
    await client.sendMessage({ text: "test", subtitleLanguage: "en" });

    latestSocket().emitEvent("tool.complete", {
      tool_id: "late-tool",
      name: "terminal",
      result: "already done",
    });
    await tick();
    latestSocket().emitEvent("tool.start", {
      tool_id: "late-tool",
      name: "terminal",
      args: { command: "pwd" },
    });
    latestSocket().emitEvent(
      "message.complete",
      { status: "complete", text: responseText() },
      "foreign-runtime",
    );
    latestSocket().emitEvent("message.complete", {
      status: "complete",
      text: responseText(),
    });
    latestSocket().emitEvent("message.complete", {
      status: "complete",
      text: responseText(),
    });
    await tick();

    assert.equal(events.filter((event) => event.type === "assistant.message").length, 1);
    assert.equal(events.filter((event) => event.type === "agent.finished").length, 1);
    assert.deepEqual(
      events
        .filter(
          (event) =>
            (event.type === "tool.started" || event.type === "tool.finished") &&
            event.id === "late-tool",
        )
        .map((event) => event.type),
      ["tool.finished", "tool.started"],
    );

    latestSocket().emitEvent("error", { message: "delayed provider failure" });
    assert.equal(
      events.some(
        (event) =>
          event.type === "agent.error" &&
          event.message === "delayed provider failure",
      ),
      true,
    );
  });

  it("restores a completed structured turn and current title after reconnect", async () => {
    const events: AgentEvent[] = [];
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "prompt.submit") return { accepted: true };
      if (request.method === "session.resume") {
        return {
          session_id: "runtime-2",
          session_key: "stored-1",
          resumed: "stored-1",
          running: false,
          messages: [{ role: "assistant", text: responseText("en") }],
        };
      }
      if (request.method === "session.title") {
        return { title: "Renamed outside Kana" };
      }
      return {};
    });
    await openSession(client);
    client.subscribe((event) => events.push(event));

    await client.sendMessage({ text: "Continue", subtitleLanguage: "en" });
    latestSocket().unexpectedClose();
    await client.connect();
    await client.openSession({
      persistentSessionId: "stored-1",
      subtitleLanguage: "en",
    });

    assert.ok(events.some((event) => event.type === "assistant.message"));
    assert.ok(events.some((event) => event.type === "agent.finished"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "session.updated" &&
          event.title === "Renamed outside Kana",
      ),
    );
  });

  it("shares one in-flight connection and automatically resumes after a drop", async () => {
    let resumeCount = 0;
    FakeWebSocket.handler = (request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "session.resume") {
        resumeCount += 1;
        return {
          session_id: "runtime-2",
          session_key: "stored-1",
          resumed: "stored-1",
          running: false,
          messages: [],
        };
      }
      if (request.method === "session.title") return { title: "Restored" };
      return {};
    };
    const client = new HermesAgentClient({
      websocketUrl: "ws://127.0.0.1:9121/api/ws",
      token: "test-token",
      requestTimeoutMs: 500,
      reconnectDelaysMs: [0],
    });
    activeClients.push(client);

    await Promise.all([client.connect(), client.connect(), client.connect()]);
    assert.equal(FakeWebSocket.instances.length, 1);
    await openSession(client);

    latestSocket().unexpectedClose();
    assert.equal(client.connectionState, "reconnecting");
    for (let index = 0; index < 8 && resumeCount === 0; index += 1) {
      await tick();
    }

    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(resumeCount, 1);
    assert.equal(client.connectionState, "connected");
  });

  it("does not retry authentication and origin rejections", async () => {
    const client = await connectedClient(() => ({}));
    latestSocket().unexpectedClose(4401, "unauthorized");
    assert.equal(client.connectionState, "authentication_failed");
    await tick();
    assert.equal(FakeWebSocket.instances.length, 1);
  });

  it("does not silently replace a deleted durable Hermes session", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "session.resume") {
        throw new Error("session not found");
      }
      return {};
    });

    await assert.rejects(
      client.openSession({
        persistentSessionId: "deleted-session",
        subtitleLanguage: "en",
      }),
      /will not silently replace the missing history/i,
    );
  });

  it("returns explicit explanations for messaging and presentation-only commands", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      throw new Error(`unexpected RPC ${request.method}`);
    });
    await openSession(client);

    const voice = await client.executeCommand({
      command: "/voice",
      subtitleLanguage: "en",
    });
    const topic = await client.executeCommand({
      command: "/topic",
      subtitleLanguage: "en",
    });
    assert.equal(voice.type, "output");
    assert.match(voice.output, /Kana Settings/);
    assert.equal(topic.type, "output");
    assert.match(topic.output, /messaging identity/);
    assert.equal(latestSocket().requests.filter((request) => request.method === "slash.exec").length, 0);
  });
});
