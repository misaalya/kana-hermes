"use client";

import { useCallback, useEffect, useState } from "react";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
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
  locale: UiLocale;
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

// Human-facing control for the managed Qwen3-TTS service. The service starts
// on demand and idles at zero cost, so the panel is just a status chip plus
// manual overrides — no addresses, PIDs, or ownership details.

export function TtsControlPanel({ locale, onInspect, onStart, onStop }: TtsControlPanelProps) {
  const copy = getCopy(locale).panels;
  const [status, setStatus] = useState<TtsRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stateLabel =
    copy.states[status?.state ?? ""] ?? status?.state ?? "";

  useEffect(() => {
    let active = true;
    void onInspect()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : copy.checkFailed);
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
        setNotice(error instanceof Error ? error.message : copy.controlFailed);
      } finally {
        setBusy(false);
      }
    },
    [copy.controlFailed, onStart, onStop],
  );

  return (
    <section aria-label={copy.ttsAria}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-ink">{copy.ttsTitle}</p>
          <p className="text-[10px] text-faint">{copy.ttsSubtitle}</p>
        </div>
        <span
          className={`border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLE[status?.state ?? ""] ?? "border-line-strong text-muted"}`}
        >
          {stateLabel}
        </span>
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-faint">{copy.ttsAutoNote}</p>

      {status?.state === "starting" ? (
        <p className="text-[11px] leading-relaxed text-muted">{copy.ttsFirstStart}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {["running", "external"].includes(status?.state ?? "") && status?.managed ? (
          <>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("restart")}>
              {copy.restart}
            </button>
            <button
              type="button"
              className={`${btnSecondary} hover:border-danger hover:text-danger`}
              disabled={busy || status.state === "external"}
              onClick={() => void run("stop")}
            >
              {copy.stop}
            </button>
          </>
        ) : null}
        {!["running", "external", "starting"].includes(status?.state ?? "") && (
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run("start")}>
            {busy ? copy.starting : copy.start}
          </button>
        )}
        <button type="button" className={btnGhost} disabled={busy} onClick={() => void onInspect().then(setStatus)}>
          {copy.refresh}
        </button>
      </div>
      <p className="mt-2 min-h-4 text-[11px] text-muted">{notice ?? status?.message ?? ""}</p>
    </section>
  );
}
