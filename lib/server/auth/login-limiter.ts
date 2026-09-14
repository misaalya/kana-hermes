// In-memory progressive lockout for the Kana access-password login.
//
// Buckets are NOT keyed by IP address: home connections behind CGNAT share one
// public address with strangers, and forwarded-for headers are spoofable.
// Instead the limiter follows OWASP's "device cookie" pattern:
//
// - A browser that has signed in successfully before carries a signed
//   login-device cookie. Its attempts count only against its own bucket, so
//   nobody else's failures can lock it out.
// - Every other attempt (no or invalid device cookie) shares one "unknown
//   clients" bucket. Guessing is still throttled globally, but a flood of
//   wrong passwords only blocks unknown browsers — never the owner's devices.
//
// Each bucket also admits one password check at a time, so a concurrent burst
// cannot run many hash comparisons before the first failure is recorded.
// State resets when the server restarts.

export type LoginBucket = { kind: "device"; deviceId: string } | { kind: "unknown" };

type LimiterPolicy = {
  maxFailsBeforeLock: number;
  lockStepsMs: readonly number[];
  failWindowMs: number;
};

const POLICIES: Record<LoginBucket["kind"], LimiterPolicy> = {
  // Unknown clients: strict, progressive, shared.
  unknown: {
    maxFailsBeforeLock: 5,
    lockStepsMs: [30_000, 120_000, 600_000, 1_800_000],
    failWindowMs: 60 * 60 * 1000,
  },
  // A known device mistyping its own password: forgiving and short.
  device: {
    maxFailsBeforeLock: 10,
    lockStepsMs: [30_000, 120_000, 600_000],
    failWindowMs: 60 * 60 * 1000,
  },
};

// Known devices are bounded by the owner's real browsers (tokens cannot be
// forged without the server secret), but keep a hard cap regardless.
const MAX_TRACKED_BUCKETS = 1_000;

type Attempt = { fails: number; lockUntil: number; lockLevel: number; lastFailAt: number };

const attempts = new Map<string, Attempt>();
const checksInFlight = new Set<string>();

function bucketKey(bucket: LoginBucket): string {
  return bucket.kind === "device" ? `device:${bucket.deviceId}` : "unknown";
}

function policyFor(bucket: LoginBucket): LimiterPolicy {
  return POLICIES[bucket.kind];
}

function getEntry(bucket: LoginBucket, now = Date.now()): Attempt | null {
  const key = bucketKey(bucket);
  const entry = attempts.get(key);
  if (!entry) return null;
  const expired =
    entry.lastFailAt > 0 &&
    now - entry.lastFailAt > policyFor(bucket).failWindowMs &&
    now >= entry.lockUntil;
  if (expired) {
    attempts.delete(key);
    return null;
  }
  return entry;
}

export type LockState = { locked: false } | { locked: true; retryAfter: number };

export function checkLock(bucket: LoginBucket = { kind: "unknown" }): LockState {
  const entry = getEntry(bucket);
  if (!entry || !entry.lockUntil) return { locked: false };
  const remaining = entry.lockUntil - Date.now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

/** Reserve before awaiting the hash check so a concurrent burst cannot bypass lockout. */
export function beginLoginAttempt(
  bucket: LoginBucket = { kind: "unknown" },
): { locked: true; retryAfter: number } | { locked: false; release: () => void } {
  const lock = checkLock(bucket);
  if (lock.locked) return lock;
  const key = bucketKey(bucket);
  if (checksInFlight.has(key)) return { locked: true, retryAfter: 1 };
  checksInFlight.add(key);
  let released = false;
  return {
    locked: false,
    release: () => {
      if (released) return;
      released = true;
      checksInFlight.delete(key);
    },
  };
}

export function recordFail(
  bucket: LoginBucket = { kind: "unknown" },
): { remainingBeforeLock: number } {
  const policy = policyFor(bucket);
  const key = bucketKey(bucket);
  const entry = getEntry(bucket) ?? { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  entry.fails += 1;
  entry.lastFailAt = Date.now();
  if (entry.fails >= policy.maxFailsBeforeLock) {
    const step = policy.lockStepsMs[Math.min(entry.lockLevel, policy.lockStepsMs.length - 1)];
    entry.lockUntil = Date.now() + step;
    entry.lockLevel += 1;
    entry.fails = 0;
  }
  if (!attempts.has(key) && attempts.size >= MAX_TRACKED_BUCKETS) {
    // Drop the oldest tracked device; the shared unknown bucket is never evicted.
    for (const candidate of attempts.keys()) {
      if (candidate !== "unknown") {
        attempts.delete(candidate);
        break;
      }
    }
  }
  attempts.set(key, entry);
  return { remainingBeforeLock: Math.max(0, policy.maxFailsBeforeLock - entry.fails) };
}

export function recordSuccess(bucket: LoginBucket = { kind: "unknown" }): void {
  attempts.delete(bucketKey(bucket));
}

/** Test seam. */
export function resetLoginLimiterForTests(): void {
  attempts.clear();
  checksInFlight.clear();
}
