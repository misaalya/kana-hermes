// In-memory progressive lockout for the Kana access-password login.
// Adapted from 9Router's login limiter; resets on process restart.
//
// Kana has no reverse-proxy IP stamping, so every caller shares a single
// bucket — a spoofed X-Forwarded-For rotation cannot escape the lockout.

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000]; // 30s, 2m, 10m, 30m
const FAIL_WINDOW_MS = 60 * 60 * 1000; // 1h since last fail → auto reset

type Attempt = { fails: number; lockUntil: number; lockLevel: number; lastFailAt: number };

const attempts = new Map<string, Attempt>();

function getEntry(key: string): Attempt | null {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (
    entry.lastFailAt &&
    Date.now() - entry.lastFailAt > FAIL_WINDOW_MS &&
    (!entry.lockUntil || Date.now() >= entry.lockUntil)
  ) {
    attempts.delete(key);
    return null;
  }
  return entry;
}

export type LockState = { locked: false } | { locked: true; retryAfter: number };

export function checkLock(key = "local"): LockState {
  const entry = getEntry(key);
  if (!entry || !entry.lockUntil) return { locked: false };
  const remaining = entry.lockUntil - Date.now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(
  key = "local",
): { remainingBeforeLock: number } {
  const entry = getEntry(key) ?? { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  entry.fails += 1;
  entry.lastFailAt = Date.now();
  if (entry.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = LOCK_STEPS_MS[Math.min(entry.lockLevel, LOCK_STEPS_MS.length - 1)];
    entry.lockUntil = Date.now() + step;
    entry.lockLevel += 1;
    entry.fails = 0;
  }
  attempts.set(key, entry);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - entry.fails) };
}

export function recordSuccess(key = "local"): void {
  attempts.delete(key);
}
