import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKanaDiagnostics,
  classifyKanaError,
  redactDiagnosticText,
  safeDiagnosticEndpoint,
  serializeKanaDiagnostics,
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
        mode: "qwen3" as const,
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
});
