/**
 * Recency planning for hydrating Kana conversations from the Hermes session
 * directory (/api/kana/sessions).
 *
 * Verified against hermes serve: session.list returns rows ordered by true
 * last activity (`ORDER BY effective_last_active DESC` over the freshest of
 * heartbeat and latest message timestamp) — NOT by started_at, which is
 * creation time. There is no last-activity field in the row payload, so the
 * array order IS the recency signal and must never be re-sorted client-side.
 *
 * The controller stamps each hydrated conversation with a monotonically
 * increasing updatedAt while inserting, and the sidebar sorts by updatedAt
 * DESC — so inserting oldest-first (and adopting the active pick last) is
 * what makes server recency order survive into the UI.
 */

export type HermesDirectoryEntry = {
  hermesSessionKey: string;
  title: string;
  messageCount: number;
  startedAt: number;
};

export type HydrationPlan = {
  /** Most-recently-active entry per Hermes order; null when nothing has content. */
  best: HermesDirectoryEntry | null;
  /** Remaining entries ordered oldest-first for sequential insertion. */
  restOldestFirst: HermesDirectoryEntry[];
};

export function planHydration(
  remote: HermesDirectoryEntry[],
): HydrationPlan {
  const best =
    remote.find((entry) => entry.messageCount > 0) ?? null;
  const restOldestFirst = [...remote]
    .filter(
      (entry) =>
        entry !== best && entry.hermesSessionKey !== best?.hermesSessionKey,
    )
    .reverse();
  return { best, restOldestFirst };
}
