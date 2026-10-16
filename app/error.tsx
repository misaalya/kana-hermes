"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { serializeKanaFatalDiagnostics } from "@/lib/diagnostics/safe-diagnostics";
import { useTheme } from "@/lib/state/use-theme";
import { useUiLocale } from "@/lib/state/use-ui-locale";
import { getCopy } from "@/lib/ui/copy";

/**
 * The workspace boundary. It keeps the root layout, so the global styles and
 * the theme tokens apply here and Kana's own pills can be used; what it does
 * not keep is the workspace, whose agent, voice, avatar, and preferences are
 * exactly what failed to load.
 *
 * `retry` re-fetches and re-renders the segment, and is Next.js's preferred
 * prop over `reset` (which only re-renders), because a failure that reaches
 * this page is usually the local server or Hermes rather than the markup.
 */
export default function KanaErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const locale = useUiLocale();
  // The page is styled through the theme tokens, so it adopts the stored theme
  // the way the workspace does; a light-theme install must not be told about a
  // failure on a dark page.
  useTheme();
  const copy = getCopy(locale).fatalError;
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const reportRef = useRef<HTMLPreElement>(null);

  // Built once per failure, so copying after a failed retry still reports the
  // failure the user is looking at rather than a newer one.
  const [report] = useState(() =>
    serializeKanaFatalDiagnostics({
      error,
      digest: error.digest,
      route: typeof window === "undefined" ? undefined : window.location.pathname,
    }),
  );

  // The fallback of a refused copy: the snapshot is shown and selected, so it
  // can still be copied by hand. A plain-http LAN install has no clipboard.
  useEffect(() => {
    if (status !== "failed") return;
    const node = reportRef.current;
    if (node) window.getSelection()?.selectAllChildren(node);
  }, [status]);

  const copyReport = useCallback(async () => {
    try {
      const clipboard: Clipboard | undefined = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("The clipboard is unavailable.");
      await clipboard.writeText(report);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }, [report]);

  return (
    <main className="flex min-h-dvh flex-col items-center overflow-y-auto px-6 py-14 text-center">
      {/* The auto margins centre the block on a tall screen and leave the top
          reachable on a short one, where a centred box would be clipped. */}
      <div className="m-auto flex w-full max-w-[560px] flex-col items-center gap-4">
        <div className="kana-mark" aria-hidden="true">か</div>
        <p className="kana-label-bubble">{copy.attentionEyebrow}</p>
        <h1 className="text-[22px] font-extrabold leading-snug text-ink">
          {copy.attentionTitle}
        </h1>
        <p className="max-w-[520px] text-[13px] font-bold leading-relaxed text-ink-dim">
          {copy.attentionBody}
        </p>
        {error.digest ? (
          <code className="rounded-full bg-surface-strong px-3 py-1 font-mono text-[11.5px] font-bold text-muted">
            {copy.reference(error.digest)}
          </code>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-accent min-h-10 px-5 text-[13px]"
            onClick={() => retry()}
          >
            {copy.tryAgain}
          </button>
          <button
            type="button"
            className="kana-focus kana-pill kana-pill-soft min-h-10 px-5 text-[13px]"
            onClick={() => void copyReport()}
          >
            {copy.copyDiagnostics}
          </button>
        </div>
        <p className="min-h-5 text-[12px] font-bold text-muted" aria-live="polite">
          {status === "copied" ? copy.copied : status === "failed" ? copy.copyFailed : ""}
        </p>
        {status === "failed" ? (
          <pre
            ref={reportRef}
            aria-label={copy.diagnosticsLabel}
            className="max-h-[220px] w-full overflow-auto whitespace-pre-wrap break-words rounded-[18px] border-2 border-line-strong bg-surface p-3.5 text-left font-mono text-[11.5px] leading-relaxed text-ink-dim"
          >
            {report}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
