import { useEffect, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import { btnGhost, btnSecondary, fieldLabel, inputBase } from "./ui";

type HermesControlPanelProps = {
  cwd: string;
  onCwdChange(cwd: string): void;
  onInspect(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStart(options: {
    port: number;
    cwd?: string;
    restart?: boolean;
  }): Promise<HermesRuntimeStatus>;
  onStop(): Promise<HermesRuntimeStatus>;
};

const STATE_STYLE: Record<string, string> = {
  running: "border-accent/50 text-accent-strong",
  starting: "border-accent/40 text-accent-strong animate-kana-pulse",
  stopping: "border-line-strong text-muted",
  failed: "border-danger/50 text-danger",
  stopped: "border-line-strong text-muted",
};

// Control panel for the managed `hermes serve` process. There is no token
// field on purpose: the server mints and holds the session token, and the
// browser connects through the Kana relay with its session cookie only.

export function HermesControlPanel({
  cwd,
  onCwdChange,
  onInspect,
  onStart,
  onStop,
}: HermesControlPanelProps) {
  const [status, setStatus] = useState<HermesRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [port, setPort] = useState(9119);
  const stateLabel = status?.state.replaceAll("_", " ") ?? "checking";

  useEffect(() => {
    let active = true;
    void onInspect()
      .then((next) => {
        if (active) {
          setStatus(next);
          setPort(next.port || 9119);
        }
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Control check failed.");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const next = await onStart({
        port,
        cwd: cwd || undefined,
        restart: action === "restart",
      });
      setStatus(next);
      setNotice(next.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Hermes control failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-bg p-3.5" aria-label="Hermes process control">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-ink">Local `hermes serve`</p>
          <p className="text-[10px] text-faint">The official, unmodified process on this machine.</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLE[status?.state ?? ""] ?? "border-line-strong text-muted"}`}>
          {stateLabel}
        </span>
      </div>

      {status?.controlAvailable ? (
        <>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2.5 text-[11px]">
            <dt className="text-faint">Executable</dt>
            <dd className="truncate font-mono text-ink-dim">{status.executable ?? "Not found"}</dd>
            <dt className="text-faint">Ownership</dt>
            <dd className="text-ink-dim">{status.managed ? "Managed by Kana" : "External or stopped"}</dd>
            <dt className="text-faint">Process</dt>
            <dd className="text-ink-dim">{status.pid ? `PID ${status.pid}` : "—"}</dd>
            <dt className="text-faint">Endpoint</dt>
            <dd className="truncate font-mono text-ink-dim">{`ws://127.0.0.1:${port}/api/ws (server-side)`}</dd>
            <dt className="text-faint">Auth</dt>
            <dd className="text-ink-dim">Token held by the Kana server</dd>
          </dl>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Local port</span>
              <input
                type="number"
                min={1024}
                max={65535}
                className={inputBase}
                value={port}
                disabled={status.managed}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Working folder (optional)</span>
              <input
                type="text"
                className={inputBase}
                value={cwd}
                placeholder="/home/user/project"
                onChange={(event) => onCwdChange(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status.state === "running" && status.managed ? (
              <>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("restart")}>
                  Restart Hermes
                </button>
                <button type="button" className={`${btnSecondary} hover:border-danger hover:text-danger`} disabled={busy} onClick={() => void run("stop")}>
                  Stop Hermes
                </button>
              </>
            ) : (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy || !status.executable || status.state === "running"}
                onClick={() => void run("start")}
              >
                {busy ? "Starting…" : "Start Hermes"}
              </button>
            )}
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void onInspect().then(setStatus)}>
              Refresh status
            </button>
          </div>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-faint">
          {status?.message ?? "Start Kana with the npm launcher to enable local process controls."}
        </p>
      )}
      <p className="mt-2 min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </section>
  );
}
