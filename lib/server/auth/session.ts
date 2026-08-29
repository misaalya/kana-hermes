import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { adoptLegacyKanaFile, resolveKanaDataDir } from "@/lib/server/data-dir";

// Stateless JWT session cookie following the 9Router dashboard pattern:
// HS256 token signed with a per-installation secret (env override or an
// auto-generated 32-byte file persisted next to the auth store).

const SESSION_COOKIE = "kana_session";
const SESSION_MAX_AGE_S = 24 * 60 * 60;

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

function sessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === SESSION_COOKIE && rest.length > 0) return rest.join("=");
  }
  return null;
}

export async function isSessionValid(request: Request): Promise<boolean> {
  return verifySessionToken(sessionTokenFromRequest(request));
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(loadSecret());
}

export async function verifySessionToken(token?: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, loadSecret());
    return true;
  } catch {
    return false;
  }
}

function shouldUseSecureCookie(request: Request): boolean {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  return request.headers.get("x-forwarded-proto") === "https";
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

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
