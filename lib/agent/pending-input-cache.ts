import type { AgentInputRequest } from "./types";

// Last input request Hermes is still waiting on, per durable session. This
// is what restores a dialog after a refresh when Hermes itself replays
// nothing: `session.resume` replays `pending_approval`/`pending_clarify` on
// Hermes 0.21+, but sudo/secret prompts (and every kind on older Hermes)
// have no server-side replay, so the client remembers them.
//
// Only request metadata is stored — kinds, ids, questions, choice labels.
// Answers, passwords, and secret values never pass through here: they go
// straight from the dialog to Hermes and are never persisted anywhere.

const STORAGE_KEY = "kana.pending-input.v1";

type PendingInputCache = Record<string, AgentInputRequest>;

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readAll(): PendingInputCache {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PendingInputCache;
  } catch {
    return {};
  }
}

function isStorable(request: AgentInputRequest): boolean {
  if (!request || typeof request !== "object") return false;
  if (request.kind === "approval") {
    return typeof request.command === "string" && typeof request.description === "string";
  }
  if (request.kind === "clarification") {
    return (
      typeof request.requestId === "string" &&
      Array.isArray(request.questions) &&
      request.questions.length > 0
    );
  }
  return typeof (request as { requestId?: unknown }).requestId === "string";
}

/** Remember an input request Hermes is blocked on. */
export function rememberPendingInput(persistentSessionId: string, request: AgentInputRequest): void {
  const store = storage();
  if (!store || !persistentSessionId || !isStorable(request)) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [persistentSessionId]: request }));
  } catch {
    // Browser storage is best-effort; the live event already updated the UI.
  }
}

/** The remembered request for a session, if it still looks answerable. */
export function readPendingInput(persistentSessionId: string): AgentInputRequest | null {
  if (!persistentSessionId) return null;
  const request = readAll()[persistentSessionId];
  return request && isStorable(request) ? request : null;
}

/** Drop the remembered request: it was answered, expired, or is stale. */
export function clearPendingInput(persistentSessionId: string): void {
  const store = storage();
  if (!store || !persistentSessionId) return;
  try {
    const all = readAll();
    if (!(persistentSessionId in all)) return;
    delete all[persistentSessionId];
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort only.
  }
}
