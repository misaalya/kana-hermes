import {
  remoteHttpUrl,
  remoteLoginUrl,
  remoteTicketUrl,
  type RemoteHermesConnection,
} from "./remote-hermes";

// Hermes gates a non-loopback dashboard behind a login. The gateway WebSocket
// then needs a fresh single-use ticket; a session cookie alone is not accepted.
// Kana keeps the cookie jar in this server process and never exposes it to the
// browser.

type Session = { cookies: Map<string, string> };

const AUTH_TIMEOUT_MS = 10_000;
const DASHBOARD_TIMEOUT_MS = 6_000;

const authKey = Symbol.for("kana.remoteHermesAuth");
type AuthGlobal = typeof globalThis & { [authKey]?: Map<string, Session> };

function sessions(): Map<string, Session> {
  const shared = globalThis as AuthGlobal;
  shared[authKey] ??= new Map();
  return shared[authKey];
}

function sessionKey(connection: RemoteHermesConnection): string {
  return `${connection.config.url}\n${connection.credentials.username}`;
}

function cookiesFrom(headers: Headers): Map<string, string> {
  const cookies = new Map<string, string>();
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  for (const value of values) {
    const pair = value.split(";", 1)[0] ?? "";
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return cookies;
}

function cookieHeader(session: Session): string {
  return [...session.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * A remote that accepts a connection but never answers must not pin the one
 * shared gateway attempt forever: every dashboard request carries a deadline.
 */
async function timedFetch(
  url: string,
  init: RequestInit,
  label: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(`Remote Hermes did not answer the ${label} in time.`);
    }
    throw error;
  }
}

async function login(connection: RemoteHermesConnection, signal: AbortSignal): Promise<Session> {
  const response = await timedFetch(remoteLoginUrl(connection.config), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "basic",
      username: connection.credentials.username,
      password: connection.credentials.password,
      next: "/",
    }),
    cache: "no-store",
    redirect: "manual",
  }, "login request", signal);
  if (response.status === 401) {
    throw new Error("Remote Hermes rejected the configured username or password.");
  }
  if (response.status === 429) {
    throw new Error("Remote Hermes rate-limited the login; wait a moment and reconnect.");
  }
  if (!response.ok) {
    throw new Error(`Remote Hermes login failed (${response.status}).`);
  }
  const cookies = cookiesFrom(response.headers);
  if (!cookies.size) {
    throw new Error("Remote Hermes login did not return a session cookie.");
  }
  return { cookies };
}

async function mintTicket(
  connection: RemoteHermesConnection,
  session: Session,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await timedFetch(remoteTicketUrl(connection.config), {
    method: "POST",
    headers: { Cookie: cookieHeader(session) },
    cache: "no-store",
    redirect: "manual",
  }, "ticket request", signal);
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`Remote Hermes could not issue a WebSocket ticket (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (
    !body
    || typeof body !== "object"
    || typeof (body as { ticket?: unknown }).ticket !== "string"
    || !(body as { ticket: string }).ticket
  ) {
    throw new Error("Remote Hermes returned an invalid WebSocket ticket.");
  }
  for (const [name, value] of cookiesFrom(response.headers)) {
    session.cookies.set(name, value);
  }
  return (body as { ticket: string }).ticket;
}

/**
 * One authenticated dashboard JSON request, logging in again on an expired
 * cookie. The cookie stays in this server process. A caller may pass a plain
 * timeout (existing reads) or a bounded method/body for a write.
 */
export async function remoteDashboardJson<T>(
  connection: RemoteHermesConnection,
  path: string,
  options: number | { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = DASHBOARD_TIMEOUT_MS,
): Promise<T> {
  const { method = "GET", body, timeoutMs } =
    typeof options === "number"
      ? { method: "GET" as const, body: undefined, timeoutMs: options }
      : { method: options.method ?? "GET", body: options.body, timeoutMs: options.timeoutMs ?? DASHBOARD_TIMEOUT_MS };
  const key = sessionKey(connection);
  const store = sessions();
  const signal = AbortSignal.timeout(timeoutMs);
  let session = store.get(key) ?? await login(connection, signal);
  store.set(key, session);

  const request = async (current: Session) => {
    return timedFetch(remoteHttpUrl(connection.config, path), {
      method,
      headers: {
        Cookie: cookieHeader(current),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
    }, "dashboard request", signal);
  };

  let response = await request(session);
  if (response.status === 401 || response.status === 403) {
    store.delete(key);
    session = await login(connection, signal);
    store.set(key, session);
    response = await request(session);
  }
  if (!response.ok) {
    throw new Error(`Remote Hermes dashboard request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

/** A fresh single-use ticket, logging in again if the cookie session expired. */
export async function remoteWsTicket(
  connection: RemoteHermesConnection,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<string> {
  const key = sessionKey(connection);
  const store = sessions();
  const signal = AbortSignal.timeout(timeoutMs);
  let session = store.get(key);
  if (!session) {
    session = await login(connection, signal);
    store.set(key, session);
  }
  const ticket = await mintTicket(connection, session, signal);
  if (ticket) return ticket;

  store.delete(key);
  session = await login(connection, signal);
  store.set(key, session);
  const retry = await mintTicket(connection, session, signal);
  if (!retry) {
    store.delete(key);
    throw new Error("Remote Hermes rejected the refreshed dashboard session.");
  }
  return retry;
}
