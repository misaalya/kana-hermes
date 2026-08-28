"use client";

import { useEffect, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import { btnGhost, btnSecondary } from "./ui";

type HermesControlPanelProps = {
  locale: UiLocale;
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
    status
      ? copy.states[status.state] ?? status.state
      : notice
        ? copy.states.failed
        : copy.states.checking;

  const refresh = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await onInspect();
      setStatus(next);
      setPort(next.port || 9119);
    } catch (error) {
      setStatus(null);
      setNotice(error instanceof Error ? error.message : copy.checkFailed);
    } finally {
      setBusy(false);
    }
  };

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
        if (active) setNotice(error instanceof Error ? error.message : copy.checkFailed);
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
              restart: action === "restart",
            });
      setStatus(next);
      setNotice(next.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.controlFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={copy.hermesAria}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-ink">{copy.hermesTitle}</p>
          <p className="text-[10px] text-faint">{copy.hermesSubtitle}</p>
        </div>
        <span className={`border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLE[status?.state ?? ""] ?? "border-line-strong text-muted"}`}>
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
            ) : status.state !== "running" ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy || !status.executable || status.state === "running"}
                onClick={() => void run("start")}
              >
                {busy ? copy.starting : copy.start}
              </button>
            ) : null}
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void refresh()}>
              {copy.refresh}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={btnGhost} disabled={busy} onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      )}
      <p className="mt-2 min-h-4 text-[11px] text-muted">
        {notice ?? status?.message ?? ""}
      </p>
    </section>
  );
}
