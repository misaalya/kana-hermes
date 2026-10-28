"use client";

import { formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { useHostSnapshot } from "./use-host-snapshot";

const TICKS = 12;

/**
 * The desktop header's host widget: CPU, memory, and disk each get a big value
 * over a segmented meter, and uptime carries Kana's own uptime and RSS. It is
 * read-only, takes no input, and lives only while the header shows it (never
 * on phones).
 */
export function HeaderHostMonitor({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const { snapshot, cpu, error } = useHostSnapshot();

  if (!snapshot) {
    return error ? (
      <p className="kana-header-host hidden text-[11px] font-bold text-danger lg:block">{copy.hostFailed}</p>
    ) : null;
  }

  const memory = percentUsed(snapshot.memory.total, snapshot.memory.available);
  const disk = snapshot.disk
    ? percentUsed(snapshot.disk.total, snapshot.disk.available)
    : null;

  return (
    <div
      role="group"
      aria-label={snapshot.hostname}
      className="kana-header-host pointer-events-none hidden w-[38vw] min-w-[380px] max-w-[520px] grid-cols-[1fr_1fr_1fr_1.5fr] gap-3 rounded-[22px] bg-surface-strong px-3.5 py-2 lg:grid"
    >
      <Metric
        label={copy.hostCpu}
        value={cpu === null ? "—" : `${Math.round(cpu)}%`}
        percent={cpu ?? 0}
      />
      <Metric label={copy.hostMemory} value={`${Math.round(memory)}%`} percent={memory} />
      <Metric
        label={copy.hostDisk}
        value={disk === null ? "—" : `${Math.round(disk)}%`}
        percent={disk ?? undefined}
      />
      <Metric
        label={copy.hostUptime}
        value={formatDuration(snapshot.uptime)}
        detail={copy.hostKanaDetail(
          formatDuration(snapshot.kana.uptime),
          formatBytes(snapshot.kana.rss),
        )}
        error={error}
        errorLabel={copy.hostFailed}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  percent,
  detail,
  error = false,
  errorLabel,
}: {
  label: string;
  value: string;
  percent?: number;
  detail?: string;
  error?: boolean;
  errorLabel?: string;
}) {
  const filled = percent === undefined ? 0 : Math.round((percent / 100) * TICKS);

  return (
    <div className="flex min-w-0 flex-col gap-1 border-l-2 border-dotted border-line-strong pl-3 first:border-l-0 first:pl-0">
      <span className="flex min-w-0 items-center gap-1 text-[9px] font-extrabold leading-none text-muted">
        <span className="truncate">{label}</span>
        {error ? (
          <span role="img" aria-label={errorLabel} className="text-[9px] font-extrabold text-danger">
            !
          </span>
        ) : null}
      </span>
      <span className="truncate text-[17px] font-extrabold leading-none text-ink tabular-nums">
        {value}
      </span>
      {percent === undefined ? (
        detail ? (
          <span className="truncate text-[9px] font-bold leading-none text-faint">{detail}</span>
        ) : null
      ) : (
        <span aria-hidden="true" data-host-ticks="" className="flex h-2.5 items-end gap-[2px]">
          {Array.from({ length: TICKS }, (_, index) => (
            <span
              key={index}
              className={`h-full w-[3px] rounded-full transition-colors duration-500 ${
                index < filled ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </span>
      )}
    </div>
  );
}
