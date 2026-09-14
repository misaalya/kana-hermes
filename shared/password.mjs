// Access-password policy and hashing shared by `kana password` and the server.
// scrypt from node:crypto keeps the launcher dependency-free and, unlike
// bcrypt, does not silently truncate long passwords.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { PASSWORD_MAX_LENGTH, passwordPolicyError } from "./password-policy.mjs";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyError } from "./password-policy.mjs";

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// 128 * N * r bytes are needed; leave headroom above Node's 32 MiB default.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {{ logN: number, r: number, p: number }} cost
 * @returns {Promise<Buffer>}
 */
function derive(password, salt, cost) {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFC"),
      salt,
      KEY_LENGTH,
      { N: 2 ** cost.logN, r: cost.r, p: cost.p, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/**
 * @param {string} password
 * @returns {Promise<string>} `scrypt$logN$r$p$salt$hash` (base64url fields)
 */
export async function hashPassword(password) {
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const salt = randomBytes(SALT_BYTES);
  const cost = { logN: SCRYPT_LOG_N, r: SCRYPT_R, p: SCRYPT_P };
  const key = await derive(password, salt, cost);
  return [
    SCRYPT_PREFIX,
    cost.logN,
    cost.r,
    cost.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** @param {string} storedHash */
export function isScryptHash(storedHash) {
  return typeof storedHash === "string" && storedHash.startsWith(`${SCRYPT_PREFIX}$`);
}

/**
 * Verifies a scrypt hash produced by hashPassword. Malformed hashes fail
 * closed instead of throwing.
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyScryptHash(password, storedHash) {
  if (typeof password !== "string" || !password || !isScryptHash(storedHash)) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6) return false;
  const [, logN, r, p, saltText, keyText] = parts;
  const cost = { logN: Number(logN), r: Number(r), p: Number(p) };
  if (
    !Number.isInteger(cost.logN) || cost.logN < 14 || cost.logN > 20 ||
    !Number.isInteger(cost.r) || cost.r < 1 || cost.r > 32 ||
    !Number.isInteger(cost.p) || cost.p < 1 || cost.p > 16
  ) {
    return false;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  if (salt.length < SALT_BYTES || expected.length !== KEY_LENGTH) return false;
  // Bound the candidate before hashing so a huge login body is not scrypted.
  if ([...password].length > PASSWORD_MAX_LENGTH) return false;
  try {
    const actual = await derive(password, salt, cost);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
