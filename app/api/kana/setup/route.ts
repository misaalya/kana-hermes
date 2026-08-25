import { getAppState, setAppState } from "@/lib/server/app-state-store";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type OnboardingState = { completedAt: number };

const ONBOARDING_KEY = "onboarding";

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

/**
 * GET /api/kana/setup
 * Install-level setup state (SQLite, shared by every browser of this user).
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const state = getAppState<OnboardingState>(ONBOARDING_KEY);
  return Response.json(
    {
      onboardingCompleted: Boolean(state?.completedAt),
      completedAt: state?.completedAt ?? null,
    },
    { headers: NO_STORE },
  );
}

/** PUT /api/kana/setup — mark the first-run wizard as completed. */
export async function PUT(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  setAppState(ONBOARDING_KEY, { completedAt: Date.now() } satisfies OnboardingState);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
