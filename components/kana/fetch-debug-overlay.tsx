"use client";

import { useState } from "react";

/**
 * Debug overlay: shows the RAW JSON responses of every server fetch
 * (session history, session directory, activity logs) stacked vertically,
 * center screen, on their own layer. Stays open until the user closes it
 * with the × button — nothing is auto-dismissed.
 */

export type FetchResponseRecord = {
  id: number;
  label: string;
  url: string;
  status: number | string;
  body: unknown;
};

type FetchDebugOverlayProps = {
  records: FetchResponseRecord[];
  onClear(): void;
};

export function FetchDebugOverlay({ records, onClear }: FetchDebugOverlayProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!records.length) return null;

  const toggle = (id: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-2.5 shadow">
          <span className="text-xs font-bold tracking-wider text-accent-strong uppercase">
            Server responses ({records.length})
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Close debug overlay"
            className="grid size-8 place-items-center rounded-lg border border-line bg-raised text-lg leading-none text-muted transition-colors hover:border-danger hover:text-danger"
          >
            ×
          </button>
        </div>

        {records.map((record) => {
          const isExpanded = expanded.has(record.id);
          const bodyText =
            typeof record.body === "string"
              ? record.body
              : JSON.stringify(record.body, null, 2);
          return (
            <article
              key={record.id}
              className="overflow-hidden rounded-xl border border-line bg-surface shadow"
            >
              <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => toggle(record.id)}
                >
                  <span className="block truncate font-mono text-[11px] font-bold text-accent-strong">
                    response {record.id}: {record.label}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-faint">
                    {record.url} · status {record.status}
                  </span>
                </button>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-muted transition-transform"
                  style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
                >
                  ›
                </span>
              </header>
              {isExpanded ? (
                <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-dim">
                  {bodyText}
                </pre>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
