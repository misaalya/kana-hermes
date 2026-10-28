"use client";

import { formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { useHostSnapshot } from "./use-host-snapshot";

/**
 * The desktop header's quiet host HUD: CPU, memory, disk, and uptime in one
 * neutral pill. It is read-only, takes no input, and lives only while the
 * header shows it (never on phones).
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
      className="kana-header-host pointer-events-none hidden items-start gap-3.5 rounded-full bg-surface-strong px-3.5 py-1.5 lg:flex"
    >
      <Metric
        label={copy.hostCpu}
        value={cpu === null ? "—" : `${Math.round(cpu)}%`}
        percent={cpu ?? 0}
      />
      <Metric label={copy.hostMemory} value={`${Math.round(memory)}%`} percent={memory} />
      {disk === null ? null : (
        <Metric label={copy.hostDisk} value={`${Math.round(disk)}%`} percent={disk} />
      )}
      <Metric label={copy.hostUptime} value={formatDuration(snapshot.uptime)} />
      {error ? (
        <span role="img" aria-label={copy.hostFailed} className="text-[11px] font-extrabold text-danger">
          !
        </span>
      ) : null}
    </div>
  );
}

function Metric({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return (
    <div className="flex min-w-[44px] flex-col gap-1">
      <span className="text-[9px] font-extrabold leading-none text-muted">{label}</span>
      <span className="text-[11.5px] font-extrabold leading-none text-ink">{value}</span>
      {percent === undefined ? null : (
        <span aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-raised">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.round(percent)}%` }}
          />
        </span>
      )}
    </div>
  );
}
