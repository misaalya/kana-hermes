import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { KanaRemoteHermesAuthConfig, KanaRemoteHermesConfig } from "./user-config";
import { kanaUserConfigPath, readKanaUserConfig } from "./user-config";

// A remote gateway is a server-side transport choice. Its URL, username, and
// password are read from config.json or a named environment variable; none of
// them ever crosses the browser boundary.

export type RemoteHermesConnection = {
  config: KanaRemoteHermesConfig;
  credentials: { username: string; password: string };
};

export function remotePassword(remote: KanaRemoteHermesConfig): string {
  const auth: KanaRemoteHermesAuthConfig = remote.auth;
  if (auth.password) return auth.password;
  const name = auth.passwordEnv ?? "";
  const value = name ? process.env[name]?.trim() : "";
  if (!value) {
    throw new Error(
      `hermes.remote.auth.passwordEnv names ${name || "an empty variable"}, but that environment variable is not set.`,
    );
  }
  return value;
}

export function remoteAuthAvailable(remote: KanaRemoteHermesConfig): boolean {
  try {
    return Boolean(remote.auth.username && remotePassword(remote));
  } catch {
    return false;
  }
}

export type RemoteHermesIntent = "remote" | "local" | "unknown";

/**
 * Whether config.json asks for a remote gateway, read without validating the
 * rest of the file. A typo in an unrelated TTS or guardrail block must not
 * take a healthy local gateway down, while a file that cannot be parsed at all
 * still fails closed.
 */
export function remoteHermesIntent(): RemoteHermesIntent {
  const filePath = kanaUserConfigPath();
  if (!existsSync(filePath)) return "local";
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unknown";
    const hermes = (parsed as Record<string, unknown>).hermes;
    if (hermes === undefined) return "local";
    if (!hermes || typeof hermes !== "object" || Array.isArray(hermes)) return "unknown";
    return "remote" in hermes ? "remote" : "local";
  } catch {
    return "unknown";
  }
}

/** The remote block Kana is configured to use, or null for local discovery. */
export function configuredRemoteHermes(): KanaRemoteHermesConfig | null {
  return readKanaUserConfig().hermes?.remote ?? null;
}

/** Resolve the remote target at connect time so a passwordEnv change is picked up. */
export function remoteHermesConnection(): RemoteHermesConnection | null {
  const config = configuredRemoteHermes();
  if (!config) return null;
  return { config, credentials: { username: config.auth.username, password: remotePassword(config) } };
}

function remoteBase(remote: KanaRemoteHermesConfig): URL {
  const url = new URL(remote.url);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/api\/ws$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * A stable, opaque identity for this remote installation. The browser keys its
 * per-Hermes model defaults by it, so it must never carry the URL or username.
 */
export function remoteRuntimeId(remote: KanaRemoteHermesConfig): string {
  const identity = `${remote.url}\n${remote.auth.username}`;
  return `remote-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

/** The dashboard HTTP endpoint beside the gateway path. */
export function remoteHttpUrl(remote: KanaRemoteHermesConfig, path: string): string {
  const url = remoteBase(remote);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  return url.toString();
}

export function remoteLoginUrl(remote: KanaRemoteHermesConfig): string {
  return remoteHttpUrl(remote, "/auth/password-login");
}

export function remoteTicketUrl(remote: KanaRemoteHermesConfig): string {
  return remoteHttpUrl(remote, "/api/auth/ws-ticket");
}

/** The health endpoint beside /api/ws; no credentials and no query values. */
export function remoteHealthUrl(remote: KanaRemoteHermesConfig): string {
  return remoteHttpUrl(remote, "/api/health");
}

export function remoteWebSocketUrl(remote: KanaRemoteHermesConfig, ticket: string): string {
  const url = new URL(remote.url);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

/** Browser-safe status for an unreadable config, never a raw parse error/path. */
export function configErrorRuntimeStatus(): {
  configError: true;
  controlAvailable: false;
  state: "failed";
  managed: false;
  port: 0;
  websocketUrl: "";
  tokenAvailable: false;
  authAvailable: false;
  wakeAvailable: false;
  message: string;
} {
  return {
    configError: true,
    controlAvailable: false,
    state: "failed",
    managed: false,
    port: 0,
    websocketUrl: "",
    tokenAvailable: false,
    authAvailable: false,
    wakeAvailable: false,
    message: "Kana's config.json could not be read; fix it and reconnect.",
  };
}

/** Browser-safe remote status: no URL, username, password, machine id, or command. */
export function remoteRuntimeStatus(
  remote: KanaRemoteHermesConfig,
  connected: boolean,
  liveRuntimeId: string | null = null,
): {
  mode: "remote";
  runtimeId: string;
  controlAvailable: false;
  state: "running" | "stopped" | "failed";
  managed: false;
  port: 0;
  websocketUrl: "";
  tokenAvailable: false;
  authAvailable: boolean;
  wakeAvailable: boolean;
  message: string;
} {
  const authAvailable = remoteAuthAvailable(remote);
  return {
    mode: "remote",
    // While a socket is open, report the runtime it actually reached; a config
    // edit must not relabel the live connection before it reconnects.
    runtimeId: liveRuntimeId ?? remoteRuntimeId(remote),
    controlAvailable: false,
    state: !authAvailable ? "failed" : connected ? "running" : "stopped",
    managed: false,
    port: 0,
    websocketUrl: "",
    tokenAvailable: false,
    authAvailable,
    wakeAvailable: Boolean(remote.instabox),
    message: authAvailable
      ? "Kana connects to the remote Hermes dashboard configured in config.json."
      : "The remote Hermes username or password is not available to the Kana server.",
  };
}
