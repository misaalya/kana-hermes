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

async function runtimeResponse(response: Response): Promise<HermesRuntimeStatus> {
  const value = (await response.json()) as HermesRuntimeStatus & { error?: string };
  if (!response.ok) throw new Error(value.error || `Hermes control failed (${response.status}).`);
  return value;
}

export async function inspectHermesRuntime(): Promise<HermesRuntimeStatus> {
  return runtimeResponse(
    await fetch("/api/local-runtime/hermes", { cache: "no-store" }),
  );
}

export async function controlHermesRuntime(options: {
  action: "start" | "restart" | "stop";
  port?: number;
  token?: string;
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
