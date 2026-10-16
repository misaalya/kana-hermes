// Checks the npm registry for a newer kana-alya release. Kana never installs
// anything from here; it only reports the version and the command to run.

import http from "node:http";
import https from "node:https";

export const UPDATE_PACKAGE_NAME = "kana-alya";
export const UPDATE_REGISTRY_URL = `https://registry.npmjs.org/${UPDATE_PACKAGE_NAME}/latest`;
export const UPDATE_INSTALL_COMMAND = `npm i -g ${UPDATE_PACKAGE_NAME}@latest`;
export const UPDATE_TIMEOUT_MS = 3_000;

/** Body cap: the `latest` document is a few KB. Anything larger is not ours. */
const MAX_BODY_BYTES = 64 * 1024;

// One optional leading "v" is allowed: npm never publishes it, but the value
// is checked on the way out too, and "v1.2.3" is a version, not garbage.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses "1.2.3", "v1.2.3", or "1.2.3-beta.1"; returns null for anything else.
 * @returns {{ core: [number, number, number]; prerelease: string[] } | null}
 */
export function parseVersion(value) {
  const match = typeof value === "string" ? SEMVER.exec(value.trim()) : null;
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Numeric identifiers are compared by value, never through float math. */
function compareNumericIdentifier(a, b) {
  const left = a.replace(/^0+(?=\d)/, "");
  const right = b.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const numA = /^\d+$/.test(a[i]);
    const numB = /^\d+$/.test(b[i]);
    if (numA && numB) {
      const diff = compareNumericIdentifier(a[i], b[i]);
      if (diff !== 0) return diff;
    } else if (numA !== numB) {
      return numA ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
}

/** Semver precedence: 1 when a > b, -1 when a < b, 0 when equal or unparseable. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * The registry's latest version, or null on any failure. Never throws and
 * always settles.
 *
 * `timeoutMs` is an absolute deadline, not a socket idle timeout: a response
 * that trickles bytes forever must not keep this pending. Redirects are NOT
 * followed (the request only ever answers what the URL itself returned).
 *
 * @param {{ url?: string; timeoutMs?: number }} [options]
 * @returns {Promise<string | null>}
 */
export function fetchLatestVersion({ url = UPDATE_REGISTRY_URL, timeoutMs = UPDATE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let request = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      resolve(value);
    };

    try {
      timer = setTimeout(() => {
        // The absolute deadline wins over an idle socket.
        try { request?.destroy(); } catch { /* already gone */ }
        finish(null);
      }, Math.max(0, timeoutMs));

      const client = new URL(url).protocol === "http:" ? http : https;
      request = client.get(url, { timeout: timeoutMs, headers: { accept: "application/json" } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(null);
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (settled) return;
          body += chunk;
          if (body.length > MAX_BODY_BYTES) {
            response.destroy();
            try { request?.destroy(); } catch { /* already gone */ }
            finish(null);
          }
        });
        response.on("end", () => {
          if (settled) return;
          let latest = null;
          try {
            const parsed = JSON.parse(body);
            // Only a string is a version. "0.5.0" (a number) is not.
            if (parsed && typeof parsed === "object" && typeof parsed.version === "string") {
              latest = parsed.version.trim();
            }
          } catch {
            latest = null;
          }
          // parseVersion accepts one leading "v"; the value Kana reports never
          // carries it, so the UI and the install command stay in one format.
          finish(latest !== null && parseVersion(latest) ? latest.replace(/^v/, "") : null);
        });
        response.on("aborted", () => finish(null));
        response.on("error", () => finish(null));
      });
      // Kept as a belt-and-braces idle guard for the socket itself; the
      // absolute deadline above is what actually bounds the call.
      request.on("timeout", () => {
        request?.destroy();
        finish(null);
      });
      request.on("error", () => finish(null));
    } catch {
      // An invalid URL, an unsupported protocol, or a synchronous client
      // failure degrades to "no version known" instead of rejecting.
      finish(null);
    }
  });
}

/**
 * @typedef {{ currentVersion: string; latestVersion: string; installCommand: string }} UpdateInfo
 */

/**
 * The update Kana reports for the running version, or null when none is known.
 * @returns {UpdateInfo | null}
 */
export function describeUpdate(currentVersion, latestVersion) {
  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) return null;
  return { currentVersion, latestVersion, installCommand: UPDATE_INSTALL_COMMAND };
}