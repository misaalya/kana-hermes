"use client";

import { useEffect, useRef, useState } from "react";
import { cpuPercent, formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { readHostSnapshot, type HostSnapshot } from "@/lib/runtime/host-client";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

const POLL_MS = 3_000;

/**
 * A read-only snapshot of the machine Kana runs on. Polling lives only while
 * this panel is mounted, so switching Settings away or closing it stops the
 * requests; nothing is stored.
 */
export function HostPanel({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const previousCpu = useRef<HostSnapshot["cpu"]["times"] | null>(null);

  useEffect(() => {
    let live = true;
    let controller: AbortController | null = null;
    const tick = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await readHostSnapshot(controller.signal);
        if (!live) return;
        setSnapshot(next);
        setCpu(cpuPercent(previousCpu.current, next.cpu.times));
        previousCpu.current = next.cpu.times;
        setError(false);
      } catch (reason) {
        if (!live || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(true);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (!snapshot) {
    return (
      <p
        role={error ? "alert" : "status"}
        className={`text-[11.5px] font-bold ${error ? "text-danger" : "text-muted"}`}
      >
        {error ? copy.hostFailed : copy.hostLoading}
      </p>
    );
  }

  const memoryPercent = percentUsed(snapshot.memory.total, snapshot.memory.available);
  const diskPercent = snapshot.disk
    ? percentUsed(snapshot.disk.total, snapshot.disk.available)
    : 0;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-extrabold text-ink">{snapshot.hostname}</p>
        <span role="status" className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-muted">
          <span className={`size-1.5 rounded-full ${error ? "bg-danger" : "bg-accent animate-kana-pulse"}`} />
          {error ? copy.hostStale : copy.hostLive}
        </span>
      </div>
      <p className="-mt-2 text-[10.5px] font-bold text-faint">
        {snapshot.platform} {snapshot.release} · {snapshot.arch}
      </p>

      <Metric
        label={copy.hostCpu}
        value={cpu === null ? "—" : `${Math.round(cpu)}%`}
        detail={copy.hostCpuDetail(snapshot.cpu.cores, snapshot.load[0].toFixed(2))}
        percent={cpu ?? 0}
      />
      <Metric
        label={copy.hostMemory}
        value={`${Math.round(memoryPercent)}%`}
        detail={copy.hostUsage(
          formatBytes(snapshot.memory.total - snapshot.memory.available),
          formatBytes(snapshot.memory.total),
        )}
        percent={memoryPercent}
      />
      {snapshot.disk ? (
        <Metric
          label={copy.hostDisk}
          value={`${Math.round(diskPercent)}%`}
          detail={copy.hostUsage(
            formatBytes(snapshot.disk.total - snapshot.disk.available),
            formatBytes(snapshot.disk.total),
          )}
          percent={diskPercent}
        />
      ) : null}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11.5px] font-extrabold text-muted">{copy.hostUptime}</span>
          <span className="text-[12px] font-extrabold text-ink">{formatDuration(snapshot.uptime)}</span>
        </div>
        <p className="mt-1 text-[10.5px] font-bold text-faint">
          {copy.hostKanaDetail(formatDuration(snapshot.kana.uptime), formatBytes(snapshot.kana.rss))}
        </p>
      </div>
      {error ? <p role="alert" className="text-[10.5px] font-bold text-danger">{copy.hostFailed}</p> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  const rounded = Math.round(percent);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] font-extrabold text-muted">{label}</span>
        <span className="text-[12px] font-extrabold text-ink">{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-strong"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${rounded}%` }}
        />
      </div>
      <p className="mt-1 text-[10.5px] font-bold text-faint">{detail}</p>
    </div>
  );
}
