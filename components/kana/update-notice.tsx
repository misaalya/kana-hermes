"use client";

import { useEffect, useRef, useState } from "react";
import { readUpdateStatus, requestStop, type UpdateStatus } from "@/lib/runtime/update-client";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import { UpdateDialog } from "./update-dialog";

/**
 * How long a successful stop may stay unconfirmed before the dialog shows the
 * honest failure. A supervisor that restarts Kana (systemd `Restart=always`)
 * never takes the tab down with it, so "Kana is stopping" must not be a dead
 * end: the dialog stays open and its own button can be pressed again.
 */
const STOP_CONFIRM_TIMEOUT_MS = 10_000;

// The user copies the command and runs it in a terminal. Kana stops itself
// only from the dialog a successful copy opens, and only on the user's press:
// there is no countdown and Kana never stops by itself.
export function UpdateNotice({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).update;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const mounted = useRef(true);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandRef = useRef<HTMLElement | null>(null);

  // Every async step below checks this before it sets state, so a StrictMode
  // double mount or a mid-request unmount never writes to a dead component.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    readUpdateStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // The copy fallback of the /docs copy button: when the clipboard is
  // unavailable (a plain-http LAN install, or a refused write) the command is
  // shown, and selected, so the user can still copy it by hand.
  useEffect(() => {
    if (!copyFailed) return;
    const node = commandRef.current;
    if (node) window.getSelection()?.selectAllChildren(node);
  }, [copyFailed]);

  if (!status?.update) return null;
  const { update } = status;

  /** The clipboard write itself: throws when the browser refuses it. */
  const writeCommand = async () => {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (!clipboard?.writeText) throw new Error("The clipboard is unavailable.");
    await clipboard.writeText(update.installCommand);
  };

  // A successful copy is what opens the dialog, and the only thing that does.
  // A failed one arms nothing: Kana must never stop before the user really
  // holds the command, so the dialog stays closed and the notice shows the
  // command to select instead. A stale copy from an earlier press is dropped
  // with it, so no dialog state outlives the copy that opened it.
  const copyCommand = async () => {
    try {
      await writeCommand();
      if (!mounted.current) return;
      setCopied(true);
      setCopyFailed(false);
      setStopFailed(false);
      setStopping(false);
      setDialogOpen(true);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      setCopyFailed(true);
      setStopFailed(false);
      setStopping(false);
      setDialogOpen(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setStopFailed(false);
    try {
      await requestStop();
      if (!mounted.current) return;
      setStopping(true);
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(() => {
        stopTimer.current = null;
        if (!mounted.current) return;
        setStopping(false);
        setStopFailed(true);
      }, STOP_CONFIRM_TIMEOUT_MS);
    } catch {
      if (!mounted.current) return;
      setStopping(false);
      setStopFailed(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Copying again before the stop is best-effort: the command is already on
  // the clipboard (that is how this dialog opened) and readable in the dialog,
  // so a refused second write must not strand the user on a dead button.
  const shutdown = async () => {
    try {
      await writeCommand();
    } catch {
      // The dialog still shows the command to select and copy by hand.
    }
    await stop();
  };

  return (
    <>
      <div className="kana-panel kana-notice flex max-w-[420px] flex-col gap-2 p-3">
        <p
          className="text-[12px] font-extrabold text-ink"
          title={copy.detail(update.latestVersion, status.currentVersion, update.installCommand)}
        >
          {copy.title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-accent min-h-9 px-3.5 text-[11px]"
            aria-label={
              copied
                ? copy.copied
                : copy.copyAria(update.latestVersion, status.currentVersion, update.installCommand)
            }
            onClick={() => void copyCommand()}
          >
            {copied ? copy.copied : copy.copy}
          </button>
        </div>
        {copyFailed ? (
          <p role="status" className="text-[11px] font-bold text-danger">
            {copy.copyFailed}
          </p>
        ) : null}
        {copyFailed ? (
          <code
            ref={commandRef}
            className="block overflow-x-auto whitespace-nowrap border-2 border-line-strong bg-surface px-2 py-1.5 font-mono text-[11.5px] text-ink"
          >
            {update.installCommand}
          </code>
        ) : null}
      </div>
      {/* Outside the notice box: the dialog's own actions must never be the
          notice's action. `role="status"` stays on its text nodes. */}
      {dialogOpen ? (
        <UpdateDialog
          update={update}
          busy={busy}
          stopping={stopping}
          stopFailed={stopFailed}
          locale={locale}
          onCancel={() => setDialogOpen(false)}
          onShutdown={() => void shutdown()}
        />
      ) : null}
    </>
  );
}