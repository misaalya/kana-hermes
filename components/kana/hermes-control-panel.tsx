"use client";

import { useEffect, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import { settingsButton, settingsButtonDanger, SettingsRow, StatusPill } from "./settings-layout";

type HermesControlPanelProps = {
  locale: UiLocale;
  onInspect(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStart(options: { port?: number; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStop(): Promise<HermesRuntimeStatus>;
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
              // Keep the port the server reported; otherwise it uses config.json.
              port: status?.port || undefined,
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

  const tone = status?.state === "running"
    ? "ok"
    : status?.state === "starting" || status?.state === "stopping"
      ? "busy"
      : status?.state === "failed" || (!status && notice)
        ? "error"
        : "idle";
  const message = notice ?? status?.message ?? "";

  return (
    <section aria-label={copy.hermesAria}>
      <SettingsRow
        label={copy.hermesTitle}
        description={<>{copy.hermesSubtitle}{message ? <span className="mt-1 block text-ink-dim">{message}</span> : null}</>}
      >
        <StatusPill tone={tone}>{stateLabel}</StatusPill>
        {status?.controlAvailable && status.state === "running" && status.managed ? (
          <>
            <button type="button" className={settingsButton} disabled={busy} onClick={() => void run("restart")}>
              {copy.restart}
            </button>
            <button type="button" className={settingsButtonDanger} disabled={busy} onClick={() => void run("stop")}>
              {copy.stop}
            </button>
          </>
        ) : status?.controlAvailable && status.state !== "running" ? (
          <button type="button" className={settingsButton} disabled={busy || !status.executable} onClick={() => void run("start")}>
            {busy ? copy.starting : copy.start}
          </button>
        ) : null}
        <button type="button" className={settingsButton} disabled={busy} onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      </SettingsRow>
    </section>
  );
}
