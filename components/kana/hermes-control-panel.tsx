"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import { PowerIcon, RestartIcon, StopIcon } from "./icons";
import {
  settingsButton,
  settingsButtonAccent,
  settingsButtonDanger,
  SettingsRow,
  SettingsRows,
  StatusPill,
} from "./settings-layout";

type HermesControlPanelProps = {
  locale: UiLocale;
  onInspect(preferredPort?: number): Promise<HermesRuntimeStatus>;
  onStart(options: { port?: number; restart?: boolean }): Promise<HermesRuntimeStatus>;
  onStop(): Promise<HermesRuntimeStatus>;
};

// Human-facing control for the managed `hermes serve` process. Technical
// details (paths, PIDs, endpoints) are deliberately not shown here: the
// server mints and holds the session token and the browser never needs them.
//
// Two rows, so state and intent never compete: the first says what Hermes is
// doing (one chip, one refresh), the second offers only the single action that
// makes sense right now. A Hermes Kana did not start is adopted as it is found
// and cannot be restarted or stopped from here.

export function HermesControlPanel({
  locale,
  onInspect,
  onStart,
  onStop,
}: HermesControlPanelProps) {
  const copy = getCopy(locale).panels;
  const [status, setStatus] = useState<HermesRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [confirm, setConfirm] = useState<"restart" | "stop" | null>(null);
  // Settings re-renders with fresh callbacks on every keystroke; refs keep the
  // status reads and the actions pointed at the current ones.
  const inspectRef = useRef(onInspect);
  const startRef = useRef(onStart);
  const stopRef = useRef(onStop);
  useEffect(() => {
    inspectRef.current = onInspect;
    startRef.current = onStart;
    stopRef.current = onStop;
  });

  const refresh = useCallback(async () => {
    try {
      setStatus(await inspectRef.current());
    } catch (error) {
      setStatus(null);
      setNotice({ text: error instanceof Error ? error.message : copy.checkFailed, failed: true });
    }
  }, [copy.checkFailed]);

  useEffect(() => {
    let active = true;
    void inspectRef.current().then(
      (next) => { if (active) setStatus(next); },
      (error) => {
        if (active) {
          setNotice({ text: error instanceof Error ? error.message : copy.checkFailed, failed: true });
        }
      },
    );
    return () => { active = false; };
  }, [copy.checkFailed]);

  // A start, stop, or restart settles in the background: follow it, so the
  // chip reaches its final state without another manual refresh.
  useEffect(() => {
    if (busy) return;
    if (status?.state !== "starting" && status?.state !== "stopping") return;
    const timer = setInterval(() => void refresh(), 1_200);
    return () => clearInterval(timer);
  }, [busy, refresh, status?.state]);

  const run = async (action: "start" | "restart" | "stop") => {
    setBusy(true);
    setNotice(null);
    setConfirm(null);
    try {
      const next =
        action === "stop"
          ? await stopRef.current()
          : await startRef.current({
              // Keep the port the server reported; otherwise it uses config.json.
              port: status?.port || undefined,
              restart: action === "restart",
            });
      setStatus(next);
      setNotice({
        text: action === "stop"
          ? copy.stoppedNotice
          : action === "restart"
            ? copy.restartedNotice
            : copy.startedNotice,
        failed: false,
      });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : copy.controlFailed, failed: true });
      // The failed attempt left a real state behind; report that one too.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "checking";
  const running = state === "running";
  const settled = state === "running" || state === "stopped" || state === "failed";
  const canControl = status?.controlAvailable ?? false;
  const tone = !status
    ? notice ? "error" : "idle"
    : running
      ? "ok"
      : state === "starting" || state === "stopping"
        ? "busy"
        : state === "failed"
          ? "error"
          : "idle";
  const stateLabel = status
    ? copy.states[state] ?? copy.states.checking
    : notice ? copy.states.failed : copy.states.checking;

  // Plain facts in the UI language, never the server's technical message.
  const facts: string[] = [];
  if (status && running) {
    facts.push(copy.runningOnPort(status.port));
    facts.push(status.managed ? copy.managedByKana : copy.externalHermes);
  } else if (status && !status.executable) {
    facts.push(copy.missingExecutable);
  }
  if (status && !canControl) facts.push(copy.controlUnavailable);
  const description = facts.length > 0 || notice
    ? (
      <>
        {facts.map((fact) => <span key={fact} className="block">{fact}</span>)}
        {notice ? (
          <span className={`block ${notice.failed ? "text-danger" : "text-accent-strong"}`}>
            {notice.text}
          </span>
        ) : null}
      </>
    )
    : undefined;

  // One row: the state chip, then only the action that makes sense right now.
  const actions: React.ReactNode[] = [];
  if (canControl && settled) {
    if (running && status?.managed) {
      const armed = confirm === "restart";
      actions.push(
        <button
          key="restart"
          type="button"
          className={settingsButton}
          disabled={busy}
          onClick={() => (armed ? void run("restart") : setConfirm("restart"))}
        >
          <RestartIcon className="size-[15px]" />
          {armed ? copy.restartConfirm : copy.restart}
        </button>,
      );
      const stopArmed = confirm === "stop";
      actions.push(
        <button
          key="stop"
          type="button"
          className={settingsButtonDanger}
          disabled={busy}
          onClick={() => (stopArmed ? void run("stop") : setConfirm("stop"))}
        >
          <StopIcon className="size-[15px]" />
          {stopArmed ? copy.stopConfirm : copy.stop}
        </button>,
      );
    } else if (!running) {
      actions.push(
        <button
          key="start"
          type="button"
          className={settingsButtonAccent}
          disabled={busy || !status?.executable}
          onClick={() => void run("start")}
        >
          <PowerIcon className="size-[15px]" />
          {busy ? copy.starting : copy.start}
        </button>,
      );
    }
  }

  return (
    <section aria-label={copy.hermesAria}>
      <SettingsRows>
        <SettingsRow label={copy.hermesTitle} description={description}>
          <StatusPill tone={tone} capitalize={false}>{stateLabel}</StatusPill>
          {actions}
        </SettingsRow>
      </SettingsRows>
    </section>
  );
}
