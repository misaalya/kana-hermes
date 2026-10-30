import type { HostSnapshot } from "@/lib/runtime/host-client";

/** The subset of Hermes `/api/system/stats` Kana reads. */
export type HermesSystemStats = {
  hostname?: string;
  os?: string;
  os_release?: string;
  arch?: string;
  cpu_count?: number;
  cpu_percent?: number;
  load_avg?: number[];
  memory?: { total?: number; available?: number; used?: number; percent?: number };
  disk?: { total?: number; free?: number; used?: number; percent?: number };
  uptime_seconds?: number;
  process?: { pid?: number; rss?: number; create_time?: number; num_threads?: number };
  psutil?: boolean;
  hermes_version?: string;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function clampPercent(value: unknown): number | undefined {
  const number = finite(value);
  return number === null ? undefined : Math.min(100, Math.max(0, number));
}

/**
 * Map Hermes's remote host sample onto the widget's local snapshot shape.
 * The remote endpoint reports CPU as a percentage and process data for the
 * Hermes server, so `kana` here means the Hermes process on that machine.
 */
export function remoteHostSnapshot(
  stats: HermesSystemStats,
  sampledAt: number,
  serverTime: HostSnapshot["serverTime"],
): HostSnapshot {
  const total = positive(stats.memory?.total) ?? 0;
  const available = finite(stats.memory?.available)
    ?? Math.max(0, total - (finite(stats.memory?.used) ?? 0));
  const diskTotal = positive(stats.disk?.total) ?? 0;
  const diskAvailable = finite(stats.disk?.free)
    ?? Math.max(0, diskTotal - (finite(stats.disk?.used) ?? 0));
  const created = finite(stats.process?.create_time);
  const load = Array.isArray(stats.load_avg) ? stats.load_avg : [];
  const cpuPercent = clampPercent(stats.cpu_percent);

  return {
    source: "remote",
    hostname: stats.hostname?.trim() || "Hermes",
    platform: stats.os?.trim() || "remote",
    release: stats.os_release?.trim() || "",
    arch: stats.arch?.trim() || "",
    cpu: {
      model: "Hermes remote",
      cores: Math.max(0, Math.floor(finite(stats.cpu_count) ?? 0)),
      times: { idle: 0, total: 0 },
      ...(cpuPercent === undefined ? {} : { percent: cpuPercent }),
    },
    load: [
      Math.max(0, finite(load[0]) ?? 0),
      Math.max(0, finite(load[1]) ?? 0),
      Math.max(0, finite(load[2]) ?? 0),
    ],
    memory: { total, available: Math.min(Math.max(0, available), total) },
    disk: diskTotal > 0
      ? { total: diskTotal, available: Math.min(Math.max(0, diskAvailable), diskTotal) }
      : null,
    uptime: Math.max(0, finite(stats.uptime_seconds) ?? 0),
    kana: {
      uptime: created === null ? 0 : Math.max(0, sampledAt / 1000 - created),
      rss: Math.max(0, finite(stats.process?.rss) ?? 0),
    },
    serverTime,
    sampledAt,
  };
}
