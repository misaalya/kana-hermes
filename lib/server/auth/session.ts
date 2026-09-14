import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";
import { accessSessionVersion } from "./password-store";
import { isSessionRevoked, revokeSession } from "./revoked-sessions";

// JWT session cookie following the 9Router dashboard pattern: HS256 token
// signed with a per-installation secret (env override or an auto-generated
// 32-byte file persisted next to the auth store). A password change revokes
// every token through the stored session version; logout revokes one token
// through its `jti` (see revoked-sessions.ts).
//
// The same secret also signs the long-lived login-device cookie used by the
// login limiter to keep a known browser usable while unknown clients are
// locked out.

export const SESSION_COOKIE = "kana_session";
const SESSION_MAX_AGE_S = 24 * 60 * 60;
export const LOGIN_DEVICE_COOKIE = "kana_login_device";
// Browsers cap cookie lifetime at 400 days.
const LOGIN_DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;
const LOGIN_DEVICE_TYPE = "login-device";

let cachedSecret: Uint8Array | null = null;

function loadSecret(): Uint8Array {
  cachedSecret ??= newSecret();
  return cachedSecret;
}

/** Ensure first-run session state exists even before a login token is minted. */
export function ensureSessionSecret(): void {
  loadSecret();
}

function secretFile(): string {
  adoptLegacyKanaFile("jwt-secret");
  return path.join(resolveKanaDataDir(), "jwt-secret");
}

function newSecret(): Uint8Array {
  const fromEnv = process.env.KANA_JWT_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error("KANA_JWT_SECRET must contain at least 32 characters.");
    }
    return new TextEncoder().encode(fromEnv);
  }
  const file = secretFile();
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw.length < 32) {
      throw new Error(
        `Kana's session secret at ${file} is invalid. It must contain at least 32 characters.`,
      );
    }
    fs.chmodSync(file, 0o600);
    return new TextEncoder().encode(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  fs.mkdirSync(resolveKanaDataDir(), { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(file, generated, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return new TextEncoder().encode(generated);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const winner = fs.readFileSync(file, "utf8").trim();
    if (winner.length < 32) {
      throw new Error(
        `Kana's session secret at ${file} is invalid. It must contain at least 32 characters.`,
      );
    }
    fs.chmodSync(file, 0o600);
    return new TextEncoder().encode(winner);
  }
}

function cookieFromRequest(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

export function sessionTokenFromRequest(request: Request): string | null {
  return cookieFromRequest(request, SESSION_COOKIE);
}

export async function isSessionValid(request: Request): Promise<boolean> {
  return verifySessionToken(sessionTokenFromRequest(request));
}

export async function createSessionToken(sessionVersion = accessSessionVersion()): Promise<string> {
  if (sessionVersion === null) throw new Error("Kana authentication state is invalid.");
  return new SignJWT({ authenticated: true, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(loadSecret());
}

export async function verifySessionToken(token?: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, loadSecret(), {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iat"],
    });
    const version = accessSessionVersion();
    // Existing installations used no version claim before their first change.
    if (
      version === null ||
      payload.authenticated !== true ||
      (payload.sessionVersion ?? "initial") !== version
    ) {
      return false;
    }
    return !(typeof payload.jti === "string" && isSessionRevoked(payload.jti));
  } catch {
    return false;
  }
}

/** Revoke one presented session token until it would have expired anyway. */
export async function revokeSessionToken(token?: string | null): Promise<void> {
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, loadSecret(), { algorithms: ["HS256"] });
    if (typeof payload.jti === "string" && typeof payload.exp === "number") {
      revokeSession(payload.jti, payload.exp * 1000);
    }
  } catch {
    // An invalid or expired token needs no revocation.
  }
}

// The device token carries the password's session version: rotating the
// password (web or `kana password`) demotes every earlier device to the shared
// unknown bucket, so a formerly trusted browser keeps no lenient quota.
export async function createLoginDeviceToken(
  sessionVersion = accessSessionVersion(),
): Promise<string> {
  if (sessionVersion === null) throw new Error("Kana authentication state is invalid.");
  return new SignJWT({ typ: LOGIN_DEVICE_TYPE, did: randomUUID(), sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LOGIN_DEVICE_MAX_AGE_S}s`)
    .sign(loadSecret());
}

/** The device id of a browser that has signed in successfully before, if any. */
export async function loginDeviceIdFromRequest(request: Request): Promise<string | null> {
  const token = cookieFromRequest(request, LOGIN_DEVICE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, loadSecret(), {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
    });
    const version = accessSessionVersion();
    return payload.typ === LOGIN_DEVICE_TYPE &&
      typeof payload.did === "string" &&
      version !== null &&
      payload.sv === version
      ? payload.did
      : null;
  } catch {
    return null;
  }
}

function shouldUseSecureCookie(request: Request): boolean {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  return new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
}

export function sessionCookie(token: string, request: Request): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_S}`,
  ];
  if (shouldUseSecureCookie(request)) attributes.push("Secure");
  return attributes.join("; ");
}

export function loginDeviceCookie(token: string, request: Request): string {
  const attributes = [
    `${LOGIN_DEVICE_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/auth",
    `Max-Age=${LOGIN_DEVICE_MAX_AGE_S}`,
  ];
  if (shouldUseSecureCookie(request)) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
