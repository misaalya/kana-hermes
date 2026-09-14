"use client";

import { useCallback, useEffect, useState } from "react";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import type { TtsProviderDescriptor } from "@/lib/voice/types";
import { settingsButton, settingsButtonDanger, SettingsRow, StatusPill } from "./settings-layout";

export type TtsRuntimeStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | "external";
  managed: boolean;
  pid?: number;
  port: number;
  executable?: string;
  model?: string;
  device?: string;
  message: string;
  provider?: TtsProviderDescriptor;
  controllable?: boolean;
};

type TtsControlPanelProps = {
  locale: UiLocale;
  onInspect(): Promise<TtsRuntimeStatus>;
  onStart(options: { restart?: boolean }): Promise<TtsRuntimeStatus>;
  onStop(): Promise<TtsRuntimeStatus>;
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

  const controllable = status?.controllable !== false;
  const state = status?.state ?? "";
  const tone = state === "running" || state === "external"
    ? "ok"
    : state === "starting" || state === "stopping"
      ? "busy"
      : state === "failed"
        ? "error"
        : "idle";
  const provider = `${status?.provider?.name ?? copy.ttsSubtitle}${status?.model ? ` · ${status.model}` : ""}`;
  const message = notice ?? status?.message ?? "";

  return (
    <section aria-label={copy.ttsAria}>
      <SettingsRow
        label={copy.ttsTitle}
        description={
          <>
            {provider}
            <span className="mt-1 block">{controllable ? copy.ttsAutoNote : null}</span>
            {state === "starting" && controllable ? <span className="mt-1 block">{copy.ttsFirstStart}</span> : null}
            {message ? <span className="mt-1 block text-ink-dim">{message}</span> : null}
          </>
        }
      >
        {stateLabel ? <StatusPill tone={tone}>{stateLabel}</StatusPill> : null}
        {controllable && ["running", "external"].includes(state) && status?.managed ? (
          <>
            <button type="button" className={settingsButton} disabled={busy} onClick={() => void run("restart")}>
              {copy.restart}
            </button>
            <button type="button" className={settingsButtonDanger} disabled={busy || state === "external"} onClick={() => void run("stop")}>
              {copy.stop}
            </button>
          </>
        ) : null}
        {controllable && !["running", "external", "starting"].includes(state) ? (
          <button type="button" className={settingsButton} disabled={busy} onClick={() => void run("start")}>
            {busy ? copy.starting : copy.start}
          </button>
        ) : null}
        <button type="button" className={settingsButton} disabled={busy} onClick={() => void onInspect().then(setStatus)}>
          {copy.refresh}
        </button>
      </SettingsRow>
    </section>
  );
}
