"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

// The human /docs page keeps its reading surface; this button is the one
// bridge to an LLM, copying the whole guide as plain Markdown.
export function CopyGuideButton({
  text,
  label,
  copiedLabel,
  ariaLabel,
  compact = false,
  className = "",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  ariaLabel: string;
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    let written = false;
    try {
      await navigator.clipboard.writeText(text);
      written = true;
    } catch {
      // Plain-http LAN pages have no Clipboard API; keep the action working.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      try {
        written = document.execCommand("copy");
      } catch {
        written = false;
      }
      area.remove();
    }
    if (!written) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }, [text]);

  const currentLabel = copied ? copiedLabel : label;
  return (
    <button
      type="button"
      className={`kana-focus ${className}`}
      onClick={() => void copy()}
      aria-label={copied ? copiedLabel : ariaLabel}
      aria-live="polite"
      title={compact ? currentLabel : undefined}
    >
      {copied ? <CheckIcon className="size-3.5 shrink-0" /> : <CopyIcon className="size-3.5 shrink-0" />}
      {compact ? null : <span>{currentLabel}</span>}
    </button>
  );
}
