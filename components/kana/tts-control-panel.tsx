import { useCallback, useEffect, useState } from "react";
import { btnGhost, btnSecondary } from "./ui";

export type TtsRuntimeStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | "external";
  managed: boolean;
  pid?: number;
  port: number;
  executable?: string;
  model?: string;
  device?: string;
  message: string;
};

type TtsControlPanelProps = {
  onInspect(): Promise<TtsRuntimeStatus>;
  onStart(options: { restart?: boolean }): Promise<TtsRuntimeStatus>;
  onStop(): Promise<TtsRuntimeStatus>;
};

const STATE_STYLE: Record<string, string> = {
  running: "border-accent/50 text-accent-strong",
  external: "border-accent/40 text-accent-strong",
  starting: "border-accent/40 text-accent-strong animate-kana-pulse",
  stopping: "border-line-strong text-muted",
  failed: "border-danger/50 text-danger",
  stopped: "border-line-strong text-muted",
};

// Control panel for the managed Qwen3-TTS service. Mirrors the Hermes control
// panel: no address fields on purpose — the browser reaches the service only
// through Kana's relay, and the server decides where it actually runs.

export function TtsControlPanel({ onInspect, onStart, onStop }: TtsControlPanelProps) {
  const [status, setStatus] = useState<TtsRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stateLabel = status?.state.replaceAll("_", " ") ?? "checking";

  useEffect(() => {
    let active = true;
    void onInspect()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "TTS check failed.");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while starting so the chip resolves to running/failed automatically.
  useEffect(() => {
    if (status?.state !== "starting") return;
    const timer = setInterval(() => {
      void onInspect()
        .then((next) => setStatus(next))
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

  const run = useCallback(
    async (action: "start" | "restart" | "stop") => {
      setBusy(true);
      setNotice(null);
      try {
        const next =
          action === "stop"
            ? await onStop()
            : await onStart({ restart: action === "restart" });
        setStatus(next);
        setNotice(next.message);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "TTS control failed.");
      } finally {
        setBusy(false);
      }
    },
    [onStart, onStop],
  );

  return (
    <section className="rounded-2xl border border-line bg-bg p-3.5" aria-label="Qwen3-TTS process control">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-ink">Local Qwen3-TTS</p>
          <p className="text-[10px] text-faint">Japanese voice service on this machine.</p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLE[status?.state ?? ""] ?? "border-line-strong text-muted"}`}
        >
          {stateLabel}
        </span>
      </div>

      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2.5 text-[11px]">
        <dt className="text-faint">Ownership</dt>
        <dd className="text-ink-dim">
          {status?.state === "external"
            ? "External (started outside Kana)"
            : status?.managed
              ? "Managed by Kana"
              : "Not running"}
        </dd>
        <dt className="text-faint">Process</dt>
        <dd className="text-ink-dim">{status?.pid ? `PID ${status.pid}` : "—"}</dd>
        <dt className="text-faint">Endpoint</dt>
        <dd className="truncate font-mono text-ink-dim">{`http://127.0.0.1:${status?.port ?? 7860} (server-side)`}</dd>
        <dt className="text-faint">Access</dt>
        <dd className="text-ink-dim">Through the Kana relay only</dd>
      </dl>

      {status?.state === "starting" ? (
        <p className="text-[11px] leading-relaxed text-muted">
          Loading the Qwen3-TTS model — the first start can download about
          2.3&nbsp;GB and take several minutes.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {["running", "external"].includes(status?.state ?? "") && (
          <>
            {status?.managed ? (
              <>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("restart")}>
                  Restart TTS
                </button>
                <button
                  type="button"
                  className={`${btnSecondary} hover:border-danger hover:text-danger`}
                  disabled={busy || status.state === "external"}
                  onClick={() => void run("stop")}
                >
                  Stop TTS
                </button>
              </>
            ) : null}
          </>
        )}
        {!["running", "external", "starting"].includes(status?.state ?? "") && (
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("start")}>
            {busy ? "Starting…" : "Start TTS"}
          </button>
        )}
        <button type="button" className={btnGhost} disabled={busy} onClick={() => void onInspect().then(setStatus)}>
          Refresh status
        </button>
      </div>
      <p className="mt-2 min-h-4 text-[11px] text-muted">{notice ?? status?.message ?? ""}</p>
    </section>
  );
}
