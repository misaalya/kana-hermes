"use client";

import { useEffect } from "react";
import { selectShowGate } from "@/lib/services/workspace-setup";
import { getCopy } from "@/lib/ui/copy";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { btnPrimary } from "./ui";

/** Recovery dialog shown only after the automatic connection attempt fails. */
export function ConnectionGate() {
  const workspace = useKanaWorkspace();
  const { actions } = workspace;
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const ready = useKanaStore("conversations", (state) => state.ready);
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  const connectionGateOpen = useKanaStore("workspace", (state) => state.connectionGateOpen);
  const connectionGateDismissed = useKanaStore("workspace", (state) => state.connectionGateDismissed);
  const automaticConnectFinished = useKanaStore("workspace", (state) => state.automaticConnectFinished);
  const connectPhase = useKanaStore("workspace", (state) => state.connectPhase);
  const hermesRuntime = useKanaStore("workspace", (state) => state.hermesRuntime);
  const hermesRuntimeNotice = useKanaStore("workspace", (state) => state.hermesRuntimeNotice);
  const hermesRuntimeBusy = useKanaStore("workspace", (state) => state.hermesRuntimeBusy);
  const showGate = selectShowGate({
    ready,
    connectionState,
    wizardMode,
    connectionGateOpen,
    connectionGateDismissed,
    automaticConnectFinished,
  });

  // The gate shows whether the server-side Hermes runtime is already
  // listening; Kana can start one itself and the relay then connects.
  useEffect(() => {
    if (showGate) void workspace.setup.inspectForGate();
  }, [showGate, workspace]);

  if (!showGate) return null;

  const copy = getCopy(locale);
  const text = copy.workspace;
  const gateCopy = copy.gate;
  const connectionInTransition = connectionState === "connecting" || connectionState === "reconnecting";
  const gateFailed =
    connectionState === "error" || connectionState === "authentication_failed" || connectionState === "incompatible";
  const detectedExternalGateway = Boolean(hermesRuntime?.state === "running" && !hermesRuntime.managed);
  const busy = connectionInTransition || connectPhase === "auto_starting";

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[var(--backdrop)] p-4" role="dialog" aria-modal="true" aria-label={text.gatewayAria}>
      <div className="kana-panel flex w-full max-w-sm flex-col items-center rounded-2xl p-6 text-center animate-kana-in">
        <p className="text-[10px] font-bold tracking-[0.16em] text-muted uppercase">{text.gatewayEyebrow}</p>
        <h2 className="mt-1 text-lg font-bold text-ink">{text.gatewayTitle}</h2>
        <p className="mt-2 max-w-[290px] text-[11px] leading-relaxed text-muted">
          {text.gatewayBody}
        </p>
        <div
          className={`mt-5 border px-3 py-1.5 text-[10px] font-semibold ${
            connectionInTransition
              ? "border-accent/35 bg-accent/8 text-accent-strong"
              : gateFailed
                ? "border-danger/35 bg-danger/8 text-danger"
                : "border-line-strong text-muted"
          }`}
        >
          {connectionState === "connecting"
            ? gateCopy.connecting
            : connectionState === "reconnecting"
              ? gateCopy.reconnecting
              : connectionState === "authentication_failed"
                ? gateCopy.authInvalid
                : connectionState === "incompatible"
                  ? gateCopy.incompatible
                  : connectionState === "error"
                    ? gateCopy.failed
                    : gateCopy.idle}
        </div>

        <button
          className={`${btnPrimary} mt-5 w-full text-sm`}
          onClick={() => void actions.connectHermes()}
          disabled={busy}
        >
          {connectionInTransition
            ? gateCopy.connecting
            : connectPhase === "auto_starting"
              ? gateCopy.startButton
              : gateCopy.connectButton}
        </button>

        <button
          type="button"
          className="kana-focus mt-2 min-h-9 w-full text-xs font-semibold text-muted hover:bg-surface-strong hover:text-ink"
          onClick={actions.dismissConnectionGate}
          disabled={busy}
        >
          {text.notNow}
        </button>

        {hermesRuntime?.controlAvailable ? (
          <div className="mt-3 flex w-full flex-col items-center gap-1 text-[9px] leading-relaxed">
            {detectedExternalGateway ? (
              <p className="text-faint">{gateCopy.detectedExternal(hermesRuntime.port)}</p>
            ) : hermesRuntime.state === "running" && hermesRuntime.managed ? (
              <p className="text-faint">{gateCopy.managedRunning(hermesRuntime.pid ?? null)}</p>
            ) : hermesRuntime.executable ? (
              <p className="text-faint">{hermesRuntimeBusy ? gateCopy.startButton : gateCopy.installedReady}</p>
            ) : (
              <p className="text-faint">{gateCopy.missingBinary}</p>
            )}
            {hermesRuntimeNotice ? (
              <p role="status" className="max-w-full break-words text-faint">{hermesRuntimeNotice}</p>
            ) : null}
            <p className="mt-1 text-faint">{gateCopy.relayNote}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
