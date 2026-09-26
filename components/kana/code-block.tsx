"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol } from "@/components/kana/material-symbol";

// The dark code block from the /docs guide: a label, a Copy button, and the
// code. Used wherever Kana shows something to paste into a terminal or file.

export function CopyButton({ text, label, doneLabel, target }: {
  text: string;
  label: string;
  doneLabel: string;
  /** Selected instead when the clipboard is unavailable (plain-http LAN). */
  target: React.RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      if (target.current) window.getSelection()?.selectAllChildren(target.current);
    }
  }, [target, text]);

  return (
    <button
      type="button"
      className="kana-focus inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink"
      onClick={() => void copy()}
      aria-live="polite"
    >
      <MaterialSymbol name={copied ? "check" : "content_copy"} className="text-[15px]" />
      {copied ? doneLabel : label}
    </button>
  );
}

export function CodeBlock({ label, code, copyLabel, copiedLabel, children }: {
  /** Shown top left, such as "Terminal" or "config.json". */
  label: string;
  /** Exactly what Copy puts on the clipboard. */
  code: string;
  copyLabel: string;
  copiedLabel: string;
  /** The rendered code, when it is highlighted; the plain code otherwise. */
  children?: React.ReactNode;
}) {
  const codeRef = useRef<HTMLElement>(null);
  return (
    <figure className="kana-code-surface overflow-hidden bg-surface-strong">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 py-1.5 pl-4 pr-1.5">
        <span className="text-[12px] font-bold text-muted">{label}</span>
        <CopyButton text={code} label={copyLabel} doneLabel={copiedLabel} target={codeRef} />
      </figcaption>
      <pre className="overflow-x-auto px-4 pb-4 pt-0.5 font-mono text-[13px] leading-relaxed text-ink">
        <code ref={codeRef}>{children ?? code}</code>
      </pre>
    </figure>
  );
}
