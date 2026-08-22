import type {
  KanaDiagnosticSnapshot,
  KanaDiagnosticsInput,
  KanaErrorCategory,
  KanaErrorRecord,
  KanaErrorSource,
} from "./types";

const SECRET_ASSIGNMENT =
  /\b(token|password|passwd|secret|authorization|cookie|api[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL = /([?&](?:token|ticket|internal|key|secret)=)[^&#\s]+/gi;

export function redactDiagnosticText(value: string): string {
  return value
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(URL_CREDENTIAL, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, "$1$2[redacted]")
    .slice(0, 500);
}

export function safeDiagnosticEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid endpoint]";
  }
}

export function classifyKanaError(
  error: unknown,
  source: KanaErrorSource,
  category?: KanaErrorCategory,
): KanaErrorRecord {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactDiagnosticText(rawMessage || "Unknown Kana error.");
  const normalized = message.toLowerCase();
  let inferred = category;

  if (!inferred) {
    if (/abort|cancel|stopp?ed|interrupt/.test(normalized)) inferred = "cancelled";
    else if (/protocol|incompatible|gateway\.ready|response validation/.test(normalized)) {
      inferred = "protocol";
    } else if (/token|unauthor|authentication|4401/.test(normalized)) {
      inferred = "authentication";
    } else if (/websocket|connect|gateway|offline|network|fetch/.test(normalized)) {
      inferred = "connection";
    } else if (/session|resume|branch/.test(normalized)) inferred = "session";
    else if (/indexeddb|storage|quota|database/.test(normalized)) inferred = "storage";
    else if (/qwen|tts|voice|audio/.test(normalized)) inferred = "voice";
    else if (/live2d|avatar|cubism|webgl|model folder/.test(normalized)) {
      inferred = "avatar";
    } else if (/speech_ja|subtitle|structured response|model response/.test(normalized)) {
      inferred = "model_response";
    } else {
      inferred = "unknown";
    }
  }

  return {
    category: inferred,
    source,
    message,
    occurredAt: Date.now(),
  };
}

export function buildKanaDiagnostics(
  input: KanaDiagnosticsInput,
): KanaDiagnosticSnapshot {
  const lastError = input.lastError
    ? {
        ...input.lastError,
        message: redactDiagnosticText(input.lastError.message),
        occurredAt: new Date(input.lastError.occurredAt).toISOString(),
      }
    : undefined;

  return {
    appVersion: input.appVersion,
    generatedAt: new Date(input.generatedAt ?? Date.now()).toISOString(),
    agent: {
      ...input.agent,
      websocketUrl: safeDiagnosticEndpoint(input.agent.websocketUrl),
    },
    voice: { ...input.voice },
    avatar: { ...input.avatar },
    storage: { ...input.storage },
    metrics: { ...input.metrics },
    ...(lastError ? { lastError } : {}),
  };
}

export function serializeKanaDiagnostics(
  input: KanaDiagnosticsInput,
): string {
  return JSON.stringify(buildKanaDiagnostics(input), null, 2);
}
