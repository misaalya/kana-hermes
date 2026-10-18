import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  CACHE_TTL_MS,
  RETRY_AFTER_FAILURE_MS,
  readUpdateStatus,
  resetUpdateStatusForTests,
  type UpdateStatusDependencies,
} from "@/lib/server/update-status";

// The registry is asked at most once an hour per server process, and a failed
// lookup is retried after a short wait instead of being cached as "no update".
// The clock and the lookup are injected so neither policy costs a real hour.

// `readUpdateStatus` compares the answer with the app version in package.json,
// so a fixture standing for "a newer release" must stay newer than the running
// version. These names sit above any release the repository could be at: a low
// fixture would become "the same version" on the day the app reached it and
// turn an expected update into "no update".
const PUBLISHED_RELEASE = "9.9.9";
const LATER_PUBLISHED_RELEASE = "9.9.10";

type Harness = {
  dependencies: UpdateStatusDependencies;
  /** Answers the next lookup returns, one per call. */
  setAnswers(...answers: Array<string | null>): void;
  advance(milliseconds: number): void;
  lookups(): number;
};

function harness(): Harness {
  let clock = 1_000_000;
  const answers: Array<string | null> = [];
  let lookups = 0;
  return {
    dependencies: {
      now: () => clock,
      fetchLatestVersion: async () => {
        lookups += 1;
        // No answer queued means "the registry had nothing new".
        return answers.length ? answers.shift()! : null;
      },
    },
    setAnswers(...next) {
      answers.push(...next);
    },
    advance(milliseconds) {
      clock += milliseconds;
    },
    lookups: () => lookups,
  };
}

beforeEach(() => {
  resetUpdateStatusForTests();
});

describe("update status cache", () => {
  it("asks the registry once and serves the cached answer for an hour", async () => {
    const h = harness();
    h.setAnswers(PUBLISHED_RELEASE, LATER_PUBLISHED_RELEASE);

    const first = await readUpdateStatus(h.dependencies);
    assert.equal(first.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(first.update?.installCommand, "npm i -g kana-alya@latest");
    assert.equal(h.lookups(), 1);

    // Still fresh: the second answer is never fetched.
    h.advance(CACHE_TTL_MS - 1);
    const cached = await readUpdateStatus(h.dependencies);
    assert.equal(cached.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(h.lookups(), 1);
  });

  it("re-reads the registry once the successful answer expires", async () => {
    const h = harness();
    h.setAnswers(PUBLISHED_RELEASE, LATER_PUBLISHED_RELEASE);
    await readUpdateStatus(h.dependencies);

    h.advance(CACHE_TTL_MS);
    const refreshed = await readUpdateStatus(h.dependencies);
    assert.equal(refreshed.update?.latestVersion, LATER_PUBLISHED_RELEASE);
    assert.equal(h.lookups(), 2);
  });

  it("retries a failed lookup after the short wait, not after an hour", async () => {
    const h = harness();
    h.setAnswers(null, PUBLISHED_RELEASE);

    const failed = await readUpdateStatus(h.dependencies);
    assert.equal(failed.update, null);
    assert.equal(h.lookups(), 1);

    // Inside the retry window the failure is served from cache...
    h.advance(RETRY_AFTER_FAILURE_MS - 1);
    await readUpdateStatus(h.dependencies);
    assert.equal(h.lookups(), 1);

    // ...and just past it the registry is asked again, so a brief outage does
    // not hide a release for a whole hour.
    h.advance(1);
    const recovered = await readUpdateStatus(h.dependencies);
    assert.equal(recovered.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(h.lookups(), 2);
  });

  it("shares one request between concurrent callers", async () => {
    const h = harness();
    h.setAnswers(PUBLISHED_RELEASE);
    const [a, b, c] = await Promise.all([
      readUpdateStatus(h.dependencies),
      readUpdateStatus(h.dependencies),
      readUpdateStatus(h.dependencies),
    ]);
    assert.equal(a.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(b.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(c.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(h.lookups(), 1);
  });

  it("recovers after a rejected lookup instead of wedging later callers", async () => {
    let rejectNext = true;
    let lookups = 0;
    let clock = 1_000;
    const dependencies: UpdateStatusDependencies = {
      now: () => clock,
      fetchLatestVersion: async () => {
        lookups += 1;
        if (rejectNext) throw new Error("registry unreachable");
        return PUBLISHED_RELEASE;
      },
    };

    // The lookup promises never to reject, but a rejected pending promise would
    // otherwise leave every later caller awaiting it forever. The rejection is
    // handled inside, so this resolves to "no update known" rather than throwing.
    const failed = await readUpdateStatus(dependencies);
    assert.equal(failed.update, null);
    assert.equal(lookups, 1);

    // The retry window is measured from the failure, so a later caller is not
    // stuck on the dead promise.
    rejectNext = false;
    clock += RETRY_AFTER_FAILURE_MS;
    const recovered = await readUpdateStatus(dependencies);
    assert.equal(recovered.update?.latestVersion, PUBLISHED_RELEASE);
    assert.equal(lookups, 2);
  });

  it("reports the running version and the payload contract, with no duplicate", async () => {
    const h = harness();
    h.setAnswers(PUBLISHED_RELEASE);
    const status = await readUpdateStatus(h.dependencies);
    const app = (await import("@/package.json")).default;
    assert.equal(status.currentVersion, app.version);
    // The client's AvailableUpdate is exactly these two fields: the current
    // version is not echoed a second time inside the update.
    assert.deepEqual(Object.keys(status.update ?? {}).sort(), ["installCommand", "latestVersion"]);
  });

  it("reports no update when the registry has none or an older one", async () => {
    const h = harness();
    h.setAnswers(null);
    assert.equal((await readUpdateStatus(h.dependencies)).update, null);
    resetUpdateStatusForTests();

    const older = harness();
    older.setAnswers("0.0.1");
    assert.equal((await readUpdateStatus(older.dependencies)).update, null);
  });
});