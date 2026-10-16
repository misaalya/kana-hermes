import pkg from "@/package.json";
import {
  describeUpdate,
  fetchLatestVersion,
  type UpdateInfo,
} from "@/shared/update-check.mjs";

// The registry is asked at most once an hour per server process. A failed
// lookup is retried after a short wait instead of being cached as "no update",
// so a brief outage does not hide a release for an hour.
export const CACHE_TTL_MS = 60 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

type UpdateCache = {
  latestVersion: string | null;
  checkedAt: number;
  pending: Promise<string | null> | null;
};

const cacheKey = Symbol.for("kana.updateStatus");
type UpdateGlobal = typeof globalThis & { [cacheKey]?: UpdateCache };

function cache(): UpdateCache {
  const shared = globalThis as UpdateGlobal;
  shared[cacheKey] ??= { latestVersion: null, checkedAt: 0, pending: null };
  return shared[cacheKey];
}

/** Test seam: drop the process-wide cache (see resetActivityStoreForTests). */
export function resetUpdateStatusForTests(): void {
  delete (globalThis as UpdateGlobal)[cacheKey];
}

export type AvailableUpdate = Pick<UpdateInfo, "latestVersion" | "installCommand">;

export type UpdateStatus = {
  currentVersion: string;
  update: AvailableUpdate | null;
};

/** Injectable clock and lookup, so tests never wait an hour. */
export type UpdateStatusDependencies = {
  now: () => number;
  fetchLatestVersion: (options?: { url?: string; timeoutMs?: number }) => Promise<string | null>;
};

const defaultDependencies: UpdateStatusDependencies = {
  now: () => Date.now(),
  fetchLatestVersion,
};

/**
 * Current version and any newer release. Asks the registry only when the
 * cached answer is stale; concurrent callers share one request.
 */
export async function readUpdateStatus(
  dependencies: UpdateStatusDependencies = defaultDependencies,
): Promise<UpdateStatus> {
  const { now } = dependencies;
  const lookup = dependencies.fetchLatestVersion;
  const state = cache();
  const age = now() - state.checkedAt;
  const fresh = state.checkedAt > 0 && age < (state.latestVersion ? CACHE_TTL_MS : RETRY_AFTER_FAILURE_MS);
  if (!fresh && !state.pending) {
    state.pending = lookup()
      .then((latest) => {
        state.latestVersion = latest;
        state.checkedAt = now();
        return latest;
      })
      // The lookup never rejects by contract, but a rejected pending promise
      // would wedge every later caller on `await state.pending`.
      .catch(() => {
        state.latestVersion = null;
        state.checkedAt = now();
        return null;
      })
      .finally(() => {
        state.pending = null;
      });
  }
  if (state.pending) await state.pending;
  return {
    currentVersion: pkg.version,
    update: availableUpdate(pkg.version, state.latestVersion),
  };
}

/**
 * The update the client shows. `describeUpdate` also echoes the current version,
 * and the response already carries it once at the top level, so it is dropped
 * here: the client's `AvailableUpdate` is the payload's contract.
 */
function availableUpdate(currentVersion: string, latestVersion: string | null): AvailableUpdate | null {
  const update = describeUpdate(currentVersion, latestVersion);
  return update ? { latestVersion: update.latestVersion, installCommand: update.installCommand } : null;
}