import { useEffect, useMemo, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";

type HermesControlPanelProps = {
  websocketUrl: string;
  token: string;
  cwd: string;
  onConnectionChange(value: { websocketUrl: string; token: string }): void;
  onInspect(): Promise<HermesRuntimeStatus>;
  onStart(options: {
    port: number;
    token: string;
    cwd?: string;
    restart?: boolean;
  }): Promise<HermesRuntimeStatus>;
  onStop(): Promise<HermesRuntimeStatus>;
  onPrepareCommand(command: string): void;
};

function portFromWebSocket(url: string): number {
  try {
    const parsed = new URL(url);
    return Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
  } catch {
    return 9119;
  }
}

function generatedToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function HermesControlPanel({
  websocketUrl,
  token,
  cwd,
  onConnectionChange,
  onInspect,
  onStart,
  onStop,
  onPrepareCommand,
}: HermesControlPanelProps) {
  const [status, setStatus] = useState<HermesRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [port, setPort] = useState(() => portFromWebSocket(websocketUrl));
  const statusLabel = useMemo(
    () => status?.state.replaceAll("_", " ") ?? "checking",
    [status],
  );

  useEffect(() => {
    let active = true;
    void onInspect()
      .then((next) => {
        if (active) {
          setStatus(next);
          setPort(next.port || portFromWebSocket(websocketUrl));
        }
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Control check failed.");
      });
    return () => {
      active = false;
    };
  }, [onInspect, websocketUrl]);

  const run = async (action: "start" | "restart" | "stop") => {
    setBusy(true);
    setNotice(null);
    try {
      if (action === "stop") {
        const next = await onStop();
        setStatus(next);
        setNotice(next.message);
        return;
      }
      if (!token.trim()) throw new Error("Create or enter a session token first.");
      const next = await onStart({
        port,
        token,
        cwd: cwd || undefined,
        restart: action === "restart",
      });
      setStatus(next);
      onConnectionChange({ websocketUrl: next.websocketUrl, token });
      setNotice(`${next.message} Save settings, then connect Kana.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Hermes control failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hermes-control-panel full-width" aria-labelledby="hermes-control-title">
      <div className="settings-subheading">
        <div>
          <strong id="hermes-control-title">Hermes control panel</strong>
          <small>Starts the official, unmodified `hermes serve` process on this machine.</small>
        </div>
        <span className={`runtime-state ${status?.state ?? "checking"}`}>
          {statusLabel}
        </span>
      </div>

      {status?.controlAvailable ? (
        <>
          <div className="runtime-details">
            <span><small>Executable</small>{status.executable ?? "Not found"}</span>
            <span><small>Ownership</small>{status.managed ? "Managed by Kana" : "External or stopped"}</span>
            <span><small>Process</small>{status.pid ? `PID ${status.pid}` : "—"}</span>
          </div>
          <div className="settings-grid runtime-controls">
            <label>
              Local port
              <input
                type="number"
                min={1024}
                max={65535}
                value={port}
                disabled={status.managed}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
            <label>
              Session token
              <span className="input-with-action">
                <input
                  type="password"
                  value={token}
                  autoComplete="off"
                  onChange={(event) =>
                    onConnectionChange({ websocketUrl, token: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={status.managed}
                  onClick={() =>
                    onConnectionChange({ websocketUrl, token: generatedToken() })
                  }
                >
                  Generate
                </button>
              </span>
            </label>
          </div>
          <div className="settings-actions inline-actions">
            {status.state === "running" && status.managed ? (
              <>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("restart")}>
                  Restart Hermes
                </button>
                <button type="button" className="secondary-button danger-text" disabled={busy} onClick={() => void run("stop")}>
                  Stop Hermes
                </button>
              </>
            ) : (
              <button type="button" className="secondary-button" disabled={busy || !status.executable || status.state === "running"} onClick={() => void run("start")}>
                {busy ? "Starting…" : "Start Hermes"}
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void onInspect().then(setStatus)}
            >
              Refresh status
            </button>
          </div>
        </>
      ) : (
        <p className="field-hint">
          {status?.message ?? "Start Kana with the npm launcher to enable local process controls."}
        </p>
      )}
      <p className="field-hint">{notice ?? status?.message}</p>
      <div className="hermes-command-shortcuts" aria-label="Hermes configuration shortcuts">
        <span>Live Hermes controls</span>
        <div>
          {["/model ", "/profile ", "/reasoning ", "/status", "/usage", "/commands"].map(
            (command) => (
              <button
                type="button"
                className="text-button"
                key={command}
                onClick={() => onPrepareCommand(command)}
              >
                {command.trim()}
              </button>
            ),
          )}
        </div>
        <small>
          Model and profile choices come from the connected Hermes registry, so Kana always follows the user&apos;s Hermes configuration.
        </small>
      </div>
    </section>
  );
}
