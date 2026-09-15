"use client";

import { useCallback, useEffect, useState } from "react";
import {
  controlVoiceEngine,
  inspectVoiceEngine,
  type VoiceEngineSnapshot,
} from "@/lib/runtime/voice-engine-client";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { settingsButton, settingsButtonDanger, SettingsRow, StatusPill } from "./settings-layout";

// Install control for the local voice engine: size before downloading,
// progress while it runs, and a way to reclaim the disk space afterwards.
// External providers have nothing to install, so the panel hides itself.

function formatBytes(bytes: number, locale: UiLocale): string {
  const gib = bytes / 1024 ** 3;
  const formatter = new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
  return gib >= 1 ? `${formatter.format(gib)} GB` : `${formatter.format(bytes / 1024 ** 2)} MB`;
}

export function VoiceEnginePanel({
  locale,
  onReadyChange,
}: {
  locale: UiLocale;
  /** Lets the voice library explain why speech is not available yet. */
  onReadyChange?(ready: boolean | null): void;
}) {
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

  useEffect(() => {
    onReadyChange?.(install ? install.state === "ready" : snapshot ? true : null);
  }, [install, onReadyChange, snapshot]);

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

  const details: React.ReactNode[] = [];
  if (install?.state === "ready") {
    details.push(copy.device(install.int8));
    if (install.modelSource === "huggingface-cache") details.push(copy.reusedCache);
    if (install.modelSource === "config") details.push(copy.configuredModel);
  } else if (install?.state === "installing" && install.step) {
    details.push(copy.progress(`${install.phase ? copy.phases[install.phase] : ""} ${copy.steps[install.step].toLowerCase()}`.trim(), percent));
  } else if (install && (install.state === "not_installed" || install.state === "failed")) {
    if (install.downloadBytes > 0) details.push(copy.downloadNote(formatBytes(install.downloadBytes, locale)));
    if (install.freeDiskBytes !== null && install.requiredDiskBytes > 0) {
      const needed = formatBytes(install.requiredDiskBytes, locale);
      const free = formatBytes(install.freeDiskBytes, locale);
      details.push(lowDisk ? copy.lowDisk(needed, free) : copy.diskNote(needed, free));
    }
  }
  const message = notice ?? (install?.state === "failed" || install?.state === "unsupported" ? install.message : null);

  return (
    <section aria-label={copy.aria}>
      <SettingsRow
        label={copy.title}
        description={
          <>
            {copy.body(snapshot?.provider?.model ?? "Irodori-TTS")}
            {details.map((detail, index) => (
              <span key={index} className={`mt-1 block ${lowDisk && index === details.length - 1 ? "text-danger" : ""}`}>{detail}</span>
            ))}
            {message ? <span className="mt-1 block text-danger">{message}</span> : null}
          </>
        }
      >
        <StatusPill tone={tone} capitalize={false}>{copy.states[state]}</StatusPill>
        {install?.state === "installing" ? (
          <button type="button" className={settingsButton} disabled={busy} onClick={() => void run("cancel")}>
            {copy.cancel}
          </button>
        ) : null}
        {install && (install.state === "not_installed" || install.state === "failed") ? (
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
      </SettingsRow>
      {install?.state === "installing" ? (
        <div
          className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-strong"
          role="progressbar"
          aria-label={copy.aria}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </section>
  );
}
