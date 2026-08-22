import type { HermesCredentialsStore } from "./types";

export type BrowserStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const SESSION_TOKEN_KEY = "kana.hermes.credentials.v1";

/**
 * Keeps the Hermes dashboard token scoped to the current browser tab. The
 * token is deliberately excluded from persistent preferences/localStorage.
 */
export class SessionHermesCredentialsStore implements HermesCredentialsStore {
  constructor(private readonly storage?: BrowserStorage) {}

  loadToken(): string {
    try {
      return this.getStorage()?.getItem(SESSION_TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  }

  saveToken(token: string): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      if (token) storage.setItem(SESSION_TOKEN_KEY, token);
      else storage.removeItem(SESSION_TOKEN_KEY);
    } catch {
      // A private browser context may reject storage. The controller still
      // retains the credential in memory for the current React lifetime.
    }
  }

  clear(): void {
    try {
      this.getStorage()?.removeItem(SESSION_TOKEN_KEY);
    } catch {
      // Best effort: session storage can be unavailable in hardened browsers.
    }
  }

  private getStorage(): BrowserStorage | null {
    if (this.storage) return this.storage;
    return typeof window === "undefined" ? null : window.sessionStorage;
  }
}
