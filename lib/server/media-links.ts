import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installationKey } from "@/lib/server/auth/session";
import { resolveKanaDataDir } from "@/lib/server/data-dir";
import { MEDIA_ROUTE } from "@/lib/presentation/media";

// Files Hermes delivers with `MEDIA:/local/path` reach the browser as signed
// links, never as paths:
//
//   MEDIA:/home/me/.hermes/cache/audio/x.mp3
//     -> MEDIA:/api/media/<token>/x.mp3   (rewritten before relaying)
//     -> GET /api/media/<token>/x.mp3     (streams the file, with Range)
//
// The token is the resolved path, encrypted and authenticated with a key
// derived from the installation secret (AES-256-GCM with a synthetic IV:
// HMAC of the path). So:
// - the browser cannot name a path, and a changed token fails to decrypt;
// - the same file always gets the same link, so a reply rendered live and
//   the same reply restored from Hermes history compare equal, and links
//   stored in the browser survive a Kana restart;
// - there is no path table to store or expire.
//
// Kana and `hermes serve` share one host (Kana discovers or spawns it), so
// the server reads the file itself. `hermes serve`'s own GET /api/media only
// returns cached images as base64, which cannot stream audio or video.

/**
 * Hermes's default (non-strict) delivery rule, mirrored from
 * gateway/platforms/base.py (validate_media_delivery_path): any existing
 * regular file, symlinks resolved, except system and credential locations.
 * Kana's own data directory (password store, session secret, config.json
 * with API keys) and the home-folder secrets below are added to the list.
 */
const DENIED_SYSTEM_PATHS = ["/etc", "/proc", "/sys", "/dev", "/root", "/boot", "/var/log", "/var/lib", "/var/run"];
const DENIED_HOME_PATHS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config", ".azure", ".gcloud", "Library/Keychains"];
/**
 * Kana's additions to Hermes's list: files in the home folder that hold
 * tokens and passwords (package registries, git, netrc, keyrings, browser
 * profiles) and shell histories, where typed secrets end up. A prompt
 * injection that names one of them gets text, never a download link.
 */
const DENIED_HOME_SECRETS = [
  ".netrc", ".git-credentials", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pypirc", ".pgpass", ".my.cnf",
  ".vault-token", ".terraform.d", ".cargo/credentials", ".cargo/credentials.toml", ".gem/credentials",
  ".m2/settings.xml", ".gradle/gradle.properties", ".password-store", ".pki", ".local/share/keyrings",
  ".mozilla", ".thunderbird", ".bash_history", ".zsh_history", ".histfile", ".python_history",
  ".node_repl_history", ".psql_history", ".mysql_history", ".sqlite_history", ".lesshst", ".viminfo",
  ".local/share/fish/fish_history",
];
const HERMES_SECRET_PATHS = [
  ".env",
  "auth.json",
  "auth.lock",
  "credentials",
  "config.yaml",
  ".anthropic_oauth.json",
  "google_token.json",
  "google_oauth_pending.json",
  "auth/google_oauth.json",
  "webhook_subscriptions.json",
  "cache/bws_cache.json",
  "cache/bws_cache.enc.json",
  "pairing",
  "mcp-tokens",
];

function realOrResolved(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function deniedPaths(home: string): string[] {
  const hermesRoots = new Set([path.join(home, ".hermes"), ...(process.env.HERMES_HOME ? [process.env.HERMES_HOME] : [])]);
  return [
    ...DENIED_SYSTEM_PATHS,
    ...[...DENIED_HOME_PATHS, ...DENIED_HOME_SECRETS].map((sub) => path.join(home, sub)),
    ...[...hermesRoots].flatMap((root) => HERMES_SECRET_PATHS.map((sub) => path.join(root, sub))),
    resolveKanaDataDir(),
  ].map(realOrResolved);
}

function within(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

/** Strip the quoting, emphasis, and sentence punctuation Hermes also strips. */
function normalizeTagPath(raw: string): string {
  let candidate = raw.trim();
  if (candidate.length >= 2 && candidate[0] === candidate.at(-1) && "`\"'".includes(candidate[0])) {
    candidate = candidate.slice(1, -1).trim();
  }
  return candidate.replace(/^[`"']+/, "").replace(/[`"'*,.;:)}\]]+$/, "");
}

/** The resolved path when `candidate` may be delivered, else null. */
export function deliverablePath(candidate: string): string | null {
  const home = os.homedir();
  const expanded = candidate.startsWith("~/") ? path.join(home, candidate.slice(2)) : candidate;
  if (!path.isAbsolute(expanded) || expanded.includes("\0")) return null;
  let resolved: string;
  try {
    resolved = fs.realpathSync(expanded);
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  const realHome = realOrResolved(home);
  for (const denied of deniedPaths(home)) {
    // /root is denied as another user's home, never as the running user's
    // own; its credential folders are separate entries and stay denied.
    if (denied === realHome) continue;
    if (within(resolved, denied)) return null;
  }
  return resolved;
}

// ---------------------------------------------------------------- tokens

const TOKEN_PURPOSE = "kana-media-link-v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 8192;

function tokenKeys(): { encryption: Buffer; iv: Buffer } {
  const key = installationKey(TOKEN_PURPOSE, 64);
  return { encryption: key.subarray(0, 32), iv: key.subarray(32) };
}

export function mediaToken(resolvedPath: string): string {
  const keys = tokenKeys();
  const plain = Buffer.from(resolvedPath, "utf8");
  const iv = createHmac("sha256", keys.iv).update(plain).digest().subarray(0, IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.encryption, iv);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
}

/** The path a token was minted for, or null for anything Kana did not mint. */
export function pathFromMediaToken(token: string): string | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKeys().encryption, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The name segment escapes everything but unreserved characters, so the
 * link ends cleanly before any Markdown around it (`**`, `)`, quotes). */
function encodeName(name: string): string {
  return encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function mediaUrl(resolvedPath: string): string {
  return `${MEDIA_ROUTE}/${mediaToken(resolvedPath)}/${encodeName(path.basename(resolvedPath))}`;
}

// ------------------------------------------------------------- rewriting

// A tag, then a quoted path or a bare absolute path. A bare path stops at
// whitespace and at a glued second tag (`MEDIA:/a.pngMEDIA:/b.png`).
const MEDIA_TAG = /MEDIA:[^\S\n]*(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|(?:~\/|\/)(?:(?!MEDIA:)[^\s`"'])+)/g;
const MAX_SPACED_TOKENS = 8;

/**
 * Blank out fenced code blocks and inline code (same length, so offsets stay
 * valid): a `MEDIA:` example in code is text, not a file to deliver. A
 * backtick-quoted path right after `MEDIA:` is a tag, not code.
 */
function maskCode(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/(MEDIA:[^\S\n]*)?(`+)[^`\n]+?\2/g, (match, tag: string | undefined) => (tag ? match : blank(match)));
}

/**
 * Hermes also accepts an unquoted path with spaces when it names a real
 * file: extend the bare match across single spaces, up to the end of the
 * line or the next tag, and take the first candidate that exists.
 */
function spacedPath(text: string, start: number): { resolved: string; end: number } | null {
  const lineEnd = text.indexOf("\n", start);
  let segment = text.slice(start, lineEnd === -1 ? undefined : lineEnd);
  const nextTag = segment.indexOf("MEDIA:", 1);
  if (nextTag !== -1) segment = segment.slice(0, nextTag);
  const parts = segment.split(/(?<=\S)(?=\s)|(?<=\s)(?=\S)/);
  let length = 0;
  let words = 0;
  for (const part of parts) {
    length += part.length;
    if (!part.trim()) continue;
    if (++words > MAX_SPACED_TOKENS) break;
    const candidate = normalizeTagPath(segment.slice(0, length));
    const resolved = deliverablePath(candidate);
    if (resolved) return { resolved, end: start + segment.indexOf(candidate) + candidate.length };
  }
  return null;
}

/**
 * Replace every deliverable `MEDIA:` path in `text` with its signed link.
 * A path that does not name a deliverable file stays as written, as Hermes
 * leaves it: a hallucinated, deleted, or denied path is never served.
 */
export function rewriteMediaTags(text: string): string {
  if (!text.includes("MEDIA:")) return text;
  const masked = maskCode(text);
  let output = "";
  let cursor = 0;
  for (const match of masked.matchAll(MEDIA_TAG)) {
    const raw = match[1];
    const rawStart = match.index + match[0].length - raw.length;
    const quoted = "`\"'".includes(raw[0]);
    const candidate = normalizeTagPath(raw);
    let resolved = deliverablePath(candidate);
    let end = rawStart + (quoted ? raw.length : raw.indexOf(candidate) + candidate.length);
    if (!resolved && !quoted) {
      const spaced = spacedPath(text, rawStart);
      if (spaced) ({ resolved, end } = spaced);
    }
    if (!resolved || rawStart < cursor) continue;
    output += text.slice(cursor, rawStart) + mediaUrl(resolved);
    cursor = end;
  }
  return output + text.slice(cursor);
}

function rewriteValue(value: unknown, skip: (record: Record<string, unknown>) => boolean): unknown {
  if (typeof value === "string") return rewriteMediaTags(value);
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, skip));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (skip(record)) return record;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, rewriteValue(item, skip)]));
  }
  return value;
}

/**
 * A Hermes RPC result for the browser. User rows keep the user's own words
 * untouched; only Hermes's replies and tool output deliver files.
 */
export function rewriteMediaInResult<T>(result: T): T {
  return rewriteValue(result, (record) => record.role === "user") as T;
}

/**
 * A Hermes event for the browser. Streamed reply chunks lose their text:
 * a chunk can end halfway through a path, and Kana shows only the finished
 * reply (message.complete), which is rewritten whole.
 */
export function rewriteMediaInEvent<T>(params: T): T {
  if (params && typeof params === "object") {
    const event = params as Record<string, unknown>;
    if (event.type === "message.delta" && event.payload && typeof event.payload === "object") {
      return { ...event, payload: { ...(event.payload as Record<string, unknown>), text: "" } } as T;
    }
  }
  return rewriteValue(params, () => false) as T;
}
