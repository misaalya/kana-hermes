import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKanaDiagnostics,
  buildKanaFatalDiagnostics,
  classifyKanaError,
  redactDiagnosticText,
  safeDiagnosticEndpoint,
  serializeKanaDiagnostics,
  serializeKanaFatalDiagnostics,
} from "@/lib/diagnostics/safe-diagnostics";

describe("safe diagnostics", () => {
  it("removes credentials and query values from endpoint data", () => {
    assert.equal(
      safeDiagnosticEndpoint(
        "ws://user:password@127.0.0.1:9119/api/ws?token=super-secret#debug",
      ),
      "ws://127.0.0.1:9119/api/ws",
    );
    assert.equal(safeDiagnosticEndpoint("not a URL"), "[invalid endpoint]");
  });

  it("redacts common credential forms from error text", () => {
    const redacted = redactDiagnosticText(
      "Authorization: Bearer abc.def token=my-token password=hunter2 " +
        "ws://localhost/api/ws?ticket=ticket-value",
    );
    assert.doesNotMatch(redacted, /abc\.def|my-token|hunter2|ticket-value/);
    assert.match(redacted, /\[redacted\]/);
  });

  it("classifies protocol and provider errors without retaining secrets", () => {
    const protocol = classifyKanaError(
      "gateway.ready protocol mismatch token=private-value",
      "agent",
    );
    assert.equal(protocol.category, "protocol");
    assert.doesNotMatch(protocol.message, /private-value/);

    const voice = classifyKanaError("Qwen3-TTS audio decode failed", "voice");
    assert.equal(voice.category, "voice");
  });

  it("serializes only safe operational state", () => {
    const input = {
      appVersion: "0.1.0",
      generatedAt: 1_700_000_000_000,
      agent: {
        mode: "hermes" as const,
        state: "connected" as const,
        websocketUrl: "ws://127.0.0.1:9119/api/ws?token=never-store-this",
      },
      voice: {
        mode: "configured" as const,
        enabled: true,
        state: "ready",
        service: "kana-qwen3-tts",
      },
      avatar: {
        mode: "live2d" as const,
        renderMode: "live2d" as const,
        loaded: true,
        source: "official-sample" as const,
      },
      storage: {
        provider: "indexeddb" as const,
        conversationCount: 2,
        messageCount: 7,
        linkedHermesSession: true,
      },
      metrics: { reconnectCount: 1, lastConnectDurationMs: 42 },
      lastError: {
        category: "authentication" as const,
        source: "agent" as const,
        message: "token=also-private",
        occurredAt: 1_700_000_000_000,
      },
    };

    const snapshot = buildKanaDiagnostics(input);
    assert.equal(snapshot.agent.websocketUrl, "ws://127.0.0.1:9119/api/ws");
    const serialized = serializeKanaDiagnostics(input);
    assert.doesNotMatch(serialized, /never-store-this|also-private/);
    assert.doesNotMatch(serialized, /prompt|conversation text|tool output/i);
  });

  it("reports a fatal boundary failure without workspace state or query values", () => {
    const input = {
      error: new RangeError("IndexedDB quota exceeded for token=private-value"),
      digest: "3f9c1d",
      route: "/?invite=never-report-this",
      generatedAt: 1_700_000_000_000,
    };

    const snapshot = buildKanaFatalDiagnostics(input);
    assert.equal(snapshot.surface, "error-boundary");
    assert.equal(snapshot.route, "/");
    assert.equal(snapshot.reference, "3f9c1d");
    assert.equal(snapshot.error.name, "RangeError");
    assert.equal(snapshot.generatedAt, "2023-11-14T22:13:20.000Z");
    assert.doesNotMatch(snapshot.error.message, /private-value/);

    const serialized = serializeKanaFatalDiagnostics(input);
    assert.doesNotMatch(serialized, /never-report-this|private-value/);
    // The workspace stores are what failed to load, so none of their state is
    // invented here.
    assert.doesNotMatch(serialized, /websocket|voice|avatar|conversationCount/);
  });

  it("reports a non-Error thrown value and omits what it does not know", () => {
    const snapshot = buildKanaFatalDiagnostics({ error: "plain failure" });
    assert.equal(snapshot.error.name, "Error");
    assert.equal(snapshot.error.message, "plain failure");
    assert.equal(snapshot.route, undefined);
    assert.equal(snapshot.reference, undefined);
  });
});
