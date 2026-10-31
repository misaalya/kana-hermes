import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { HermesCustomProvider } from "@/lib/runtime/hermes-models-client";

/** What happened when Kana tried to apply a saved provider or model at once. */
export type ModelChangeRestart =
  | { status: "restarted" | "reconnecting" | "busy" | "not-managed" | "remote" | "not-running" }
  | { status: "failed"; message: string };

export type AddHermesModelResult = {
  provider: HermesCustomProvider;
  restart: ModelChangeRestart;
};

type RestartProbe = Pick<
  HermesRuntimeStatus,
  "mode" | "state" | "managed" | "controlAvailable"
>;

/**
 * A saved provider or model is already in Hermes's configuration. Restarting
 * the managed `hermes serve` loads keys and startup state it read only when it
 * started; a runtime Kana does not own is left alone, and a running turn is
 * never interrupted.
 */
export async function restartManagedHermesForModelChange(deps: {
  busy: boolean;
  inspect(): Promise<RestartProbe>;
  restart(): Promise<unknown>;
  reconnect(): Promise<boolean>;
}): Promise<ModelChangeRestart> {
  if (deps.busy) return { status: "busy" };
  try {
    const inspected = await deps.inspect();
    if (inspected.mode === "remote") return { status: "remote" };
    if (!inspected.controlAvailable || inspected.state === "disabled") {
      return { status: "not-managed" };
    }
    if (inspected.state === "stopped") return { status: "not-running" };
    if (!inspected.managed) return { status: "not-managed" };
    await deps.restart();
    return { status: (await deps.reconnect()) ? "restarted" : "reconnecting" };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
