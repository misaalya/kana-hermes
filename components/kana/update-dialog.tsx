"use client";

import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import type { AvailableUpdate } from "@/lib/runtime/update-client";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

/**
 * The manual-update panel the copy command opens, after 9router's own dialog:
 * the command in full, the short technical steps that follow it, and the one
 * button that stops this Kana server so the install can run. It never stops
 * anything on its own — no countdown, no timer — and it stays open and
 * retryable when the stop fails, so no state here is a dead end.
 */
export function UpdateDialog({
  update,
  busy,
  stopping,
  stopFailed,
  locale,
  onCancel,
  onShutdown,
}: {
  update: AvailableUpdate;
  /** A stop request is in flight: the two actions wait for it. */
  busy: boolean;
  /** The server accepted the stop, and it has not taken the tab down yet. */
  stopping: boolean;
  /** The stop was refused or never arrived: honest, and retryable. */
  stopFailed: boolean;
  locale: UiLocale;
  onCancel(): void;
  onShutdown(): void;
}) {
  const copy = getCopy(locale).update;
  // Escape leaves the dialog; the opener (the notice's copy button) gets focus
  // back when it unmounts. The dialog itself takes the first focus, so a key
  // the user was already pressing cannot activate Cancel or the shutdown.
  const { dialogRef, onDialogKeyDown } = useDialogFocus(onCancel, { initialFocus: "dialog" });
  const status = stopping ? copy.stopping : stopFailed ? copy.failed : "";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--backdrop)] p-3"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="kana-notice-dialog w-[min(460px,100%)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto border-2 border-line-strong bg-surface-strong p-5 outline-none"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kana-update-dialog-title"
        onKeyDown={onDialogKeyDown}
      >
        <h2 id="kana-update-dialog-title" className="text-[17px] font-extrabold text-ink">
          {copy.dialogTitle(update.latestVersion)}
        </h2>
        <code className="mt-3 block overflow-x-auto whitespace-nowrap border-2 border-line-strong bg-surface px-2.5 py-2 font-mono text-[12.5px] text-ink">
          {update.installCommand}
        </code>
        <ol className="mt-4 list-decimal pl-5 text-[12.5px] leading-relaxed text-muted">
          {copy.steps.map((step) => (
            <li key={step} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
        {status ? (
          <p
            role="status"
            className={`mt-3 text-[11.5px] font-bold ${stopFailed ? "text-danger" : "text-muted"}`}
          >
            {status}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-soft min-h-9 px-4 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-accent min-h-9 px-4 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={onShutdown}
          >
            {copy.shutdown}
          </button>
        </div>
      </section>
    </div>
  );
}