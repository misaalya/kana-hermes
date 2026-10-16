"use client";

import type { CSSProperties } from "react";
import { useUiLocale } from "@/lib/state/use-ui-locale";
import { getCopy } from "@/lib/ui/copy";

/**
 * The root-layout boundary, for a failure `app/error.tsx` cannot catch. It
 * replaces the root layout, so it renders its own document and Next.js applies
 * no global styles to it: no `globals.css`, no theme tokens, no web font. Every
 * style below is therefore inline, and every value keeps the dark theme's own
 * as its fallback (`--bg`, `--ink`, `--ink-dim`, `--surface-strong`, `--muted`,
 * `--chat-bubble`, `--chat-text`, and the striped `--accent`/`--accent-hover`
 * primary pill that `kana-pill-accent` draws), so the page is legible whether
 * or not the stylesheet reached it, and follows the theme when it did.
 * `app/error.tsx` shows the same page with the real classes.
 *
 * It carries no diagnostics copy on purpose. A failure this early leaves no
 * promise that the clipboard or the preference record still works, and the
 * reference Next.js logs for the failure is shown inline instead, which is what
 * a report needs.
 */

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    minHeight: "100dvh",
    margin: 0,
    padding: "56px 24px",
    background: "var(--bg, #1c1c1c)",
    color: "var(--ink, #f4f4f4)",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    textAlign: "center",
  },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 74,
    height: 74,
    borderRadius: 999,
    background: "var(--accent, #599dc6)",
    color: "var(--on-accent, #07131a)",
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1,
  },
  eyebrow: {
    margin: 0,
    padding: "3px 11px",
    borderRadius: 999,
    background: "var(--chat-bubble, #263943)",
    color: "var(--chat-text, #f4f4f4)",
    fontSize: 11.5,
    fontWeight: 800,
  },
  title: {
    maxWidth: 520,
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.4,
  },
  body: {
    maxWidth: 520,
    margin: 0,
    color: "var(--ink-dim, #c8c8c8)",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.7,
  },
  reference: {
    margin: 0,
    padding: "4px 12px",
    borderRadius: 999,
    background: "var(--surface-strong, #2b2b2b)",
    color: "var(--muted, #969696)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 11.5,
    fontWeight: 700,
  },
  button: {
    minHeight: 40,
    marginTop: 8,
    padding: "12px 20px",
    border: 0,
    borderRadius: 999,
    background:
      "repeating-linear-gradient(-45deg, var(--accent, #599dc6) 0 14px, var(--accent-hover, #70aed2) 14px 28px)",
    color: "var(--on-accent, #07131a)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 800,
  },
};

export default function KanaGlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const locale = useUiLocale();
  const copy = getCopy(locale).fatalError;

  return (
    <html lang="en">
      <body style={styles.page}>
        <div style={styles.mark} aria-hidden="true">か</div>
        <p style={styles.eyebrow}>{copy.startEyebrow}</p>
        <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <h1 style={styles.title}>{copy.startTitle}</h1>
          <p style={styles.body}>{copy.startBody}</p>
          {error.digest ? <code style={styles.reference}>{copy.reference(error.digest)}</code> : null}
          <button type="button" style={styles.button} onClick={() => retry()}>
            {copy.tryAgain}
          </button>
        </main>
      </body>
    </html>
  );
}
