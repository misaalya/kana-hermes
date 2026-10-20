"use client";

import { useCallback, useEffect, useState } from "react";
import {
  controlVoiceEngine,
  inspectVoiceEngine,
  type VoiceEngineSnapshot,
} from "@/lib/runtime/voice-engine-client";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import {
  settingsButton,
  settingsButtonDanger,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  StatusPill,
} from "./settings-layout";

// Install control for the local voice engine: size before downloading,
// progress while it runs, and a way to reclaim the disk space afterwards.
// External providers have nothing to install, so the panel hides itself.

function formatBytes(bytes: number, locale: UiLocale): string {
  const gib = bytes / 1024 ** 3;
  const formatter = new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
  return gib >= 1 ? `${formatter.format(gib)} GB` : `${formatter.format(bytes / 1024 ** 2)} MB`;
}

export function VoiceEnginePanel({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).voiceEngine;
  const [snapshot, setSnapshot] = useState<VoiceEngineSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const install = snapshot?.install ?? null;

  const refresh = useCallback(async () => {
    try {
      const next = await inspectVoiceEngine();
      setSnapshot(next);
      return next;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.failedCheck);
      return null;
    }
  }, [copy.failedCheck]);

  useEffect(() => {
    let active = true;
    void inspectVoiceEngine()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : copy.failedCheck);
      });
    return () => {
      active = false;
    };
  }, [copy.failedCheck]);

  // Poll while downloading so the bar and the final state update by themselves.
  useEffect(() => {
    if (install?.state !== "installing") return;
    const timer = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(timer);
  }, [install?.state, refresh]);

  const run = async (action: "install" | "cancel" | "remove") => {
    setBusy(true);
    setNotice(null);
    setConfirmRemove(false);
    try {
      setSnapshot(await controlVoiceEngine(action));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy.failedCheck);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (snapshot && !install) return null;

  const state = install?.state ?? "checking";
  const tone = state === "ready" ? "ok" : state === "installing" ? "busy" : state === "failed" ? "error" : "idle";
  const percent = install && install.totalBytes > 0
    ? Math.min(100, Math.floor((install.completedBytes / install.totalBytes) * 100))
    : 0;
  const partial = Boolean(
    install && install.state !== "ready" &&
      (install.engineInstalled || install.modelInstalled || install.partialDownloadBytes > 0),
  );
  // Anything Kana put on disk can be removed, including a cancelled download.
  const removable = Boolean(
    install && install.state !== "installing" &&
      (install.engineInstalled || install.modelSource === "download" || install.partialDownloadBytes > 0),
  );
  const lowDisk = Boolean(
    install && install.freeDiskBytes !== null && install.requiredDiskBytes > 0 &&
      install.freeDiskBytes < install.requiredDiskBytes,
  );
  const showFacts = Boolean(
    install && (install.state === "not_installed" || install.state === "failed"),
  );
  const needed = showFacts && install && install.requiredDiskBytes > 0
    ? formatBytes(install.requiredDiskBytes, locale)
    : null;
  const free = showFacts && install && install.freeDiskBytes !== null
    ? formatBytes(install.freeDiskBytes, locale)
    : null;

  const notes: string[] = [];
  if (install?.state === "ready") {
    if (install.modelSource === "huggingface-cache") notes.push(copy.reusedCache);
    if (install.modelSource === "config") notes.push(copy.configuredModel);
  }
  const progressLabel = install?.state === "installing" && install.step
    ? copy.progress(
        `${install.phase ? copy.phases[install.phase] : ""} ${copy.steps[install.step].toLowerCase()}`.trim(),
        percent,
      )
    : null;
  const message = notice ?? (install?.state === "failed" || install?.state === "unsupported" ? install.message : null);

  return (
    <SettingsGroup
      title={copy.title}
      ariaLabel={copy.aria}
      action={<StatusPill tone={tone} capitalize={false}>{copy.states[state]}</StatusPill>}
    >
      {snapshot ? (
        <SettingsRows>
          <SettingsRow label={copy.modelLabel} inline>
            <span className="text-xs font-semibold text-ink-dim">
              {snapshot.provider?.model ?? "Irodori-TTS"}
            </span>
          </SettingsRow>
          {showFacts && install && install.downloadBytes > 0 ? (
            <SettingsRow label={copy.downloadLabel} inline>
              <span className="text-xs font-semibold text-ink-dim">
                {formatBytes(install.downloadBytes, locale)}
              </span>
            </SettingsRow>
          ) : null}
          {needed !== null && free !== null ? (
            <SettingsRow label={copy.diskLabel} inline>
              <span className={`text-xs font-semibold ${lowDisk ? "text-danger" : "text-ink-dim"}`}>
                {copy.diskValue(needed, free)}
              </span>
            </SettingsRow>
          ) : null}
          {install?.state === "ready" ? (
            <SettingsRow label={copy.deviceLabel} inline>
              <span className="text-xs font-semibold text-ink-dim">{copy.device(install.int8)}</span>
            </SettingsRow>
          ) : null}
        </SettingsRows>
      ) : null}
      {install?.state === "installing" ? (
        <div className="mt-3">
          <div
            className="h-2.5 overflow-hidden rounded-full bg-surface-strong"
            role="progressbar"
            aria-label={copy.aria}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          {progressLabel ? (
            <p role="status" className="mt-1.5 text-[11.5px] font-semibold text-muted">{progressLabel}</p>
          ) : null}
        </div>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="mt-2 text-[11.5px] leading-relaxed text-muted">{note}</p>
      ))}
      {lowDisk && needed !== null && free !== null ? (
        <p role="status" className="mt-2 text-[11.5px] font-semibold text-danger">
          {copy.lowDisk(needed, free)}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 text-[11.5px] font-semibold text-danger">{message}</p>
      ) : null}
      {install?.state === "installing" || showFacts || removable ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2 max-sm:justify-start">
          {install?.state === "installing" ? (
            <button type="button" className={settingsButton} disabled={busy} onClick={() => void run("cancel")}>
              {copy.cancel}
            </button>
          ) : null}
          {showFacts ? (
            <button type="button" className={settingsButton} disabled={busy || lowDisk} onClick={() => void run("install")}>
              {partial ? copy.resume : copy.install}
            </button>
          ) : null}
          {removable ? (
            <button
              type="button"
              className={settingsButtonDanger}
              disabled={busy}
              onClick={() => (confirmRemove ? void run("remove") : setConfirmRemove(true))}
            >
              {confirmRemove ? copy.confirmRemove : copy.remove}
            </button>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  );
}
