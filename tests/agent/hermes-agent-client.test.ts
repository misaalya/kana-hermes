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

// Fake relay transport: the client now speaks HTTP RPC + SSE instead of a
// direct WebSocket, so the test double intercepts fetch() and EventSource().

class FakeRelay {
  static handler: RpcHandler = () => ({});
  static requests: RpcRequest[] = [];
  static streams: FakeEventSource[] = [];

  static reset(): void {
    FakeRelay.handler = () => ({});
    FakeRelay.requests = [];
    FakeRelay.streams = [];
  }

  static rpcResponse(result: unknown): Response {
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  static rpcError(message: string, status = 502): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
    FakeRelay.streams.push(this);
    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      this.send("gateway", { connected: true });
    });
  }

  close(): void {
    this.closed = true;
  }

  send(event: string, data: unknown): void {
    this.dispatchEvent(
      new MessageEvent(event, { data: JSON.stringify(data) }),
    );
  }

  emitEvent(
    type: string,
    payload: Record<string, unknown> = {},
    sessionId = "runtime-1",
  ): void {
    this.send("hermes", {
      jsonrpc: "2.0",
      method: "event",
      params: { type, session_id: sessionId, payload },
    });
  }

  unexpectedClose(): void {
    this.dispatchEvent(new Event("error"));
  }
}

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== "/api/hermes/rpc") {
        return new Response("not found", { status: 404 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      const request: RpcRequest = {
        jsonrpc: "2.0",
        id: `fake-${FakeRelay.requests.length + 1}`,
        method: String(body.method ?? ""),
        params: body.params ?? {},
      };
      FakeRelay.requests.push(request);
      try {
        const result = await FakeRelay.handler(request);
        return FakeRelay.rpcResponse(result);
      } catch (error) {
        return FakeRelay.rpcError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}

function restoreBrowserGlobals(): void {
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: originalEventSource,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
}

function latestStream(): FakeEventSource {
  const stream = FakeEventSource.instances.at(-1);
  assert.ok(stream);
  return stream;
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
  FakeRelay.handler = handler;
  const client = new HermesAgentClient({
    requestTimeoutMs: 500,
  });
  activeClients.push(client);
  await client.connect();
  return client;
}

async function openSession(client: HermesAgentClient): Promise<void> {
  await client.openSession({ title: "Test", subtitleLanguage: "en" });
}

describe("HermesAgentClient (relay transport)", () => {
  beforeEach(() => {
    installBrowserGlobals();
    FakeRelay.reset();
    FakeEventSource.instances = [];
    activeClients = [];
  });

  afterEach(async () => {
    await Promise.all(activeClients.map((client) => client.disconnect()));
    for (const stream of FakeEventSource.instances) stream.close();
    restoreBrowserGlobals();
  });

  it("lands a failed first connect in a terminal error state instead of staying connecting", async () => {
    class UnreachableSource extends EventTarget {
      constructor() {
        super();
        queueMicrotask(() => {
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("gateway", {
              data: JSON.stringify({
                connected: false,
                message: "Kana is not managing a Hermes gateway with a known session token.",
              }),
            }),
          );
        });
      }
      close(): void {}
    }
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: UnreachableSource,
    });

    const client = new HermesAgentClient();
    activeClients.push(client);
    const events: AgentEvent[] = [];
    client.subscribe((event) => events.push(event));

    await assert.rejects(client.connect(), /not managing a Hermes gateway/);

    const last = events.at(-1);
    assert.ok(last);
    assert.equal(last.type, "connection.changed");
    if (last.type === "connection.changed") {
      assert.equal(last.state, "error");
      assert.match(last.message ?? "", /not managing a Hermes gateway/);
    }
  });

  it("never puts a token in a URL and creates a Kana-scoped session", async () => {
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
    // The relay transport must carry no credential anywhere.
    assert.equal(FakeEventSource.instances.some((stream) => stream.url.includes("token=")), false);
    const create = FakeRelay.requests.find(
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
    latestStream().emitEvent("message.complete", {
      status: "complete",
      text: responseText(),
    });
    await tick();
    assert.equal(promptCount, 2);

    await client.executeCommand({ command: "/goal continue", subtitleLanguage: "en" });
    latestStream().emitEvent("message.complete", { status: "interrupted" });
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

  it("translates input and tool events and reconnects after a stream drop", async () => {
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

    latestStream().emitEvent("clarify.request", {
      request_id: "clarify-1",
      question: "Which option?",
      choices: ["A", "B"],
    });
    latestStream().emitEvent("tool.start", {
      tool_id: "tool-1",
      name: "terminal",
      args: { command: "pwd" },
    });
    latestStream().emitEvent("tool.complete", {
      tool_id: "tool-1",
      name: "terminal",
      result: "done",
      duration_s: 0.25,
    });
    assert.ok(events.some((event) => event.type === "input.requested"));
    assert.ok(events.some((event) => event.type === "tool.started"));
    assert.ok(events.some((event) => event.type === "tool.finished"));

    latestStream().unexpectedClose();
    assert.equal(client.connectionState, "reconnecting");
    await client.connect();
    assert.equal(client.connectionState, "connected");
    assert.equal(FakeEventSource.instances.length, 2);
    const resumed = await client.openSession({
      persistentSessionId: "stored-1",
      subtitleLanguage: "en",
    });
    assert.equal(resumed.sessionId, "runtime-2");
    assert.ok(FakeRelay.requests.some((request) => request.method === "session.resume"));
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

    latestStream().emitEvent("tool.complete", {
      tool_id: "late-tool",
      name: "terminal",
      result: "already done",
    });
    await tick();
    latestStream().emitEvent("tool.start", {
      tool_id: "late-tool",
      name: "terminal",
      args: { command: "pwd" },
    });
    latestStream().emitEvent(
      "message.complete",
      { status: "complete", text: responseText() },
      "foreign-runtime",
    );
    latestStream().emitEvent("message.complete", {
      status: "complete",
      text: responseText(),
    });
    latestStream().emitEvent("message.complete", {
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

    latestStream().emitEvent("error", { message: "delayed provider failure" });
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
    latestStream().unexpectedClose();
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

  it("delivers resumed transcript rows via history.restored and fetchHistory uses the runtime id", async () => {
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
          messages: [
            { role: "user", text: "hello" },
            { role: "assistant", text: responseText() },
          ],
        };
      }
      if (request.method === "session.history") {
        return { count: 0, messages: [] };
      }
      return {};
    });
    client.subscribe((event) => events.push(event));

    await client.openSession({
      persistentSessionId: "stored-1",
      subtitleLanguage: "en",
    });

    const restored = events.find((event) => event.type === "history.restored");
    assert.ok(restored && restored.type === "history.restored");
    assert.equal(restored.persistentSessionId, "stored-1");
    assert.equal(restored.sessionId, "runtime-2");
    assert.deepEqual(
      restored.messages.map((message) => message.role),
      ["user", "assistant"],
    );

    // session.history resolves runtime ids only — never the durable key.
    const history = await client.fetchHistory();
    assert.deepEqual(history, { count: 0, messages: [] });
    const historyCall = FakeRelay.requests.find(
      (request) => request.method === "session.history",
    );
    assert.ok(historyCall);
    assert.equal(historyCall.params.session_id, "runtime-2");

    // Without an opened session the client refuses instead of sending a
    // doomed lookup (durable keys fail with JSON-RPC 4001).
    const detached = new HermesAgentClient({ requestTimeoutMs: 500 });
    activeClients.push(detached);
    await assert.rejects(detached.fetchHistory(), /open a hermes session/i);
  });

  it("shares one in-flight connection and automatically resumes after a drop", async () => {
    let resumeCount = 0;
    FakeRelay.handler = (request) => {
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
      requestTimeoutMs: 500,
      reconnectDelaysMs: [0],
    });
    activeClients.push(client);

    await Promise.all([client.connect(), client.connect(), client.connect()]);
    assert.equal(FakeEventSource.instances.length, 1);
    await openSession(client);

    latestStream().unexpectedClose();
    assert.equal(client.connectionState, "reconnecting");
    for (let index = 0; index < 8 && resumeCount === 0; index += 1) {
      await tick();
    }

    assert.equal(FakeEventSource.instances.length, 2);
    assert.equal(resumeCount, 1);
    assert.equal(client.connectionState, "connected");
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
    assert.equal(FakeRelay.requests.filter((request) => request.method === "slash.exec").length, 0);
  });

  it("lists provider-scoped models and switches the open session with an explicit provider", async () => {
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "model.options") {
        return {
          provider: "fireworks_ai",
          model: "accounts/fireworks/models/deepseek-v4-flash-0731",
          providers: [
            {
              slug: "fireworks_ai",
              name: "Fireworks AI",
              models: ["accounts/fireworks/models/deepseek-v4-flash-0731"],
              is_current: true,
              authenticated: true,
            },
            {
              slug: "openrouter",
              name: "OpenRouter",
              models: ["deepseek/deepseek-v4"],
              authenticated: true,
            },
          ],
        };
      }
      if (request.method === "config.set") {
        return { key: "model", value: "deepseek/deepseek-v4", scope: "session" };
      }
      return {};
    });
    await openSession(client);

    const catalog = await client.listModels();
    assert.equal(catalog.provider, "fireworks_ai");
    assert.equal(catalog.providers[1]?.models[0], "deepseek/deepseek-v4");

    const suggestions = await client.completeCommands("/model deepseek-v4");
    assert.equal(suggestions.length, 2);
    assert.match(suggestions[0]?.text ?? "", /--provider 'fireworks_ai' --session$/);

    await client.selectModel({ provider: "openrouter", model: "deepseek/deepseek-v4" });
    assert.deepEqual(
      FakeRelay.requests.findLast((request) => request.method === "config.set")?.params,
      {
        session_id: "runtime-1",
        key: "model",
        value: "'deepseek/deepseek-v4' --provider 'openrouter' --session",
        confirm_expensive_model: false,
      },
    );
  });

  it("preserves Hermes approval choices and sends the selected session decision", async () => {
    const events: AgentEvent[] = [];
    const client = await connectedClient((request) => {
      if (request.method === "session.create") {
        return { session_id: "runtime-1", stored_session_id: "stored-1" };
      }
      if (request.method === "approval.respond") return { resolved: true };
      return {};
    });
    await openSession(client);
    client.subscribe((event) => events.push(event));

    latestStream().emitEvent("approval.request", {
      command: "find /home/user -name .env",
      description: "Search protected files",
      choices: ["once", "session", "deny"],
      allow_permanent: false,
    });
    const requested = events.find((event) => event.type === "input.requested");
    assert.ok(requested?.type === "input.requested" && requested.request.kind === "approval");
    assert.deepEqual(requested.request.choices, ["once", "session", "deny"]);

    await client.respondToInput({ kind: "approval", choice: "session" });
    assert.deepEqual(
      FakeRelay.requests.findLast((request) => request.method === "approval.respond")?.params,
      { session_id: "runtime-1", choice: "session", all: false },
    );
  });
});
