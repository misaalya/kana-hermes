"use client";

import { useEffect, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import { btnGhost, btnSecondary, inputBase } from "./ui";

type HermesControlPanelProps = {
  locale: UiLocale;
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

// Human-facing control for the managed `hermes serve` process. Technical
// details (paths, PIDs, endpoints) are deliberately not shown here: the
// server mints and holds the session token and the browser never needs them.

export function HermesControlPanel({
  locale,
  cwd,
  onCwdChange,
  onInspect,
  onStart,
  onStop,
}: HermesControlPanelProps) {
  const copy = getCopy(locale).panels;
  const [status, setStatus] = useState<HermesRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [port, setPort] = useState(9119);
  const stateLabel =
    copy.states[status?.state ?? ""] ?? status?.state ?? "";

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
      const next =
        action === "stop"
          ? await onStop()
          : await onStart({
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
          <p className="text-xs font-bold text-ink">{copy.hermesTitle}</p>
          <p className="text-[10px] text-faint">{copy.hermesSubtitle}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLE[status?.state ?? ""] ?? "border-line-strong text-muted"}`}>
          {stateLabel}
        </span>
      </div>

      {status?.controlAvailable ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {status.state === "running" && status.managed ? (
              <>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("restart")}>
                  {copy.restart}
                </button>
                <button type="button" className={`${btnSecondary} hover:border-danger hover:text-danger`} disabled={busy} onClick={() => void run("stop")}>
                  {copy.stop}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy || !status.executable || status.state === "running"}
                onClick={() => void run("start")}
              >
                {busy ? copy.starting : copy.start}
              </button>
            )}
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void onInspect().then(setStatus)}>
              {copy.refresh}
            </button>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-faint marker:content-none [&::-webkit-details-marker]:hidden">
              {copy.advanced}
            </summary>
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-muted">{copy.portLabel}</span>
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
                <span className="text-[10px] font-semibold text-muted">{copy.cwdLabel}</span>
                <input
                  type="text"
                  className={inputBase}
                  value={cwd}
                  placeholder={copy.cwdPlaceholder}
                  onChange={(event) => onCwdChange(event.target.value)}
                />
              </label>
            </div>
          </details>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-faint">
          {status?.message ?? ""}
        </p>
      )}
      <p className="mt-2 min-h-4 text-[11px] text-muted">{notice ?? ""}</p>
    </section>
  );
}
