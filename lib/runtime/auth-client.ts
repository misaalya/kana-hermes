export type AuthStatus = {
  authEnabled: boolean;
  authenticated: boolean;
  usingDefaultPassword?: boolean;
};

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  if (!response.ok) throw new Error(`Auth status failed (${response.status}).`);
  return (await response.json()) as AuthStatus;
}

export async function changeAccessPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(value.error || `Could not change the password (${response.status}).`);
  }
}

export async function logoutAccessSession(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  // Full navigation on purpose: resets every client-side cache after logout.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

