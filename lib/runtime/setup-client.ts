// Browser client for install-level setup state (server SQLite, shared across
// browsers). The first-run wizard is keyed on this, not on localStorage — a
// new browser must not see the wizard again once this installation finished.

export type SetupState = {
  onboardingCompleted: boolean;
  completedAt: number | null;
};

export async function fetchSetupState(): Promise<SetupState | null> {
  try {
    const response = await fetch("/api/kana/setup", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as SetupState;
  } catch {
    // Server unreachable: callers fall back to browser-local behavior.
    return null;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  const response = await fetch("/api/kana/setup", {
    method: "PUT",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not save the setup state.");
  }
}
