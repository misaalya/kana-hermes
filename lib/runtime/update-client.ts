// Browser client for the npm-update surface: the running version, the newer
// release the user installs by hand, and the one action that stops this Kana
// server so the install can run. Kana never runs npm and never installs
// anything — the command only ever lands on the user's clipboard.

export type AvailableUpdate = {
  latestVersion: string;
  installCommand: string;
};

export type UpdateStatus = {
  currentVersion: string;
  update: AvailableUpdate | null;
};

async function updateResponse<T>(response: Response): Promise<T> {
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `Update request failed (${response.status}).`);
  return value;
}

/** The running version and, when npm has a newer release, the install command. */
export async function readUpdateStatus(): Promise<UpdateStatus> {
  return updateResponse<UpdateStatus>(
    await fetch("/api/update", { cache: "no-store", credentials: "same-origin" }),
  );
}

/** Stops this Kana server, after the user has copied the command. */
export async function requestStop(): Promise<void> {
  await updateResponse<{ stopping: boolean }>(
    await fetch("/api/update/stop", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    }),
  );
}