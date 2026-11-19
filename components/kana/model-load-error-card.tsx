"use client";

import { getCopy, type UiLocale } from "@/lib/ui/copy";
import type { ModelLoadProblem } from "@/lib/ui/model-load-error";
import { AlertIcon, ResetIcon } from "./icons";

/** A failed model listing: what went wrong, what to do, and a retry. */
export function ModelLoadErrorCard({
  locale,
  problem,
  retrying = false,
  onRetry,
  className = "",
}: {
  locale: UiLocale;
  problem: ModelLoadProblem;
  retrying?: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const copy = getCopy(locale).settings;
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-[18px] border-2 border-danger/25 bg-danger/8 px-3.5 py-3 ${className}`}
    >
      <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-extrabold text-danger">
          <span>{copy.modelLoadFailed}</span>
          {problem.status ? (
            <span className="rounded-full bg-danger/12 px-2 py-0.5 text-[10px] font-bold tabular-nums">
              HTTP {problem.status}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-[11.5px] font-bold leading-relaxed text-ink-dim">{problem.detail}</p>
        {problem.hint ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{problem.hint}</p>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="kana-pill kana-pill-soft kana-focus mt-2.5 min-h-8 px-3.5 text-[12px] disabled:opacity-60"
          >
            <ResetIcon className={`size-3.5 ${retrying ? "animate-spin" : ""}`} aria-hidden="true" />
            {copy.modelLoadRetry}
          </button>
        ) : null}
      </div>
    </div>
  );
}
