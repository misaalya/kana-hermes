export type HermesRuntimeStatus = {
  controlAvailable: boolean;
  state: "disabled" | "stopped" | "starting" | "running" | "stopping" | "failed";
  managed: boolean;
  executable?: string;
  pid?: number;
  port: number;
  websocketUrl: string;
  message: string;
};

// The Hermes session token never crosses this boundary: the Kana server mints
// and holds it, and the browser connects through the server-side relay.

async function runtimeResponse(response: Response): Promise<HermesRuntimeStatus> {
  const value = (await response.json()) as HermesRuntimeStatus & { error?: string };
  if (!response.ok) throw new Error(value.error || `Hermes control failed (${response.status}).`);
  return value;
}

export function hermesPortFromWebSocketUrl(url: string): number {
  try {
    const parsed = new URL(url);
    return Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
  } catch {
    return 9119;
  }
}

export async function inspectHermesRuntime(preferredPort?: number): Promise<HermesRuntimeStatus> {
  const query = preferredPort ? `?port=${preferredPort}` : "";
  return runtimeResponse(
    await fetch(`/api/local-runtime/hermes${query}`, { cache: "no-store" }),
  );
}

export async function controlHermesRuntime(options: {
  action: "start" | "restart" | "stop";
  port?: number;
  cwd?: string;
}): Promise<HermesRuntimeStatus> {
  return runtimeResponse(
    await fetch("/api/local-runtime/hermes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }),
  );
}
