import { NO_STORE, withSession } from "@/lib/server/api-response";
import { getAppState, setAppState } from "@/lib/server/app-state-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OnboardingState = { completedAt: number };

const ONBOARDING_KEY = "onboarding";

/**
 * GET /api/kana/setup
 * Install-level setup state (SQLite, shared by every browser of this user).
 */
export const GET = withSession(async () => {
  const state = getAppState<OnboardingState>(ONBOARDING_KEY);
  return Response.json(
    {
      onboardingCompleted: Boolean(state?.completedAt),
      completedAt: state?.completedAt ?? null,
    },
    { headers: NO_STORE },
  );
});

/** PUT /api/kana/setup — mark the first-run wizard as completed. */
export const PUT = withSession(async () => {
  setAppState(ONBOARDING_KEY, { completedAt: Date.now() } satisfies OnboardingState);
  return Response.json({ ok: true }, { headers: NO_STORE });
});
