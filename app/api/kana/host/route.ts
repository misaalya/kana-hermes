import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { remoteHostSnapshot, type HermesSystemStats } from "@/lib/host/remote-snapshot";
import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { remoteHermesConnection, remoteHermesIntent } from "@/lib/server/remote-hermes";
import { remoteDashboardJson } from "@/lib/server/remote-hermes-auth";
import type { HostSnapshot } from "@/lib/runtime/host-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOTE_CACHE_MS = 2_500;

type RemoteHostCache = {
  key: string;
  expiresAt: number;
  snapshot: HostSnapshot | null;
  inFlight: Promise<HostSnapshot> | null;
};

const hostCacheKey = Symbol.for("kana.remoteHostCache");
type HostCacheGlobal = typeof globalThis & { [hostCacheKey]?: RemoteHostCache };

function remoteCache(): RemoteHostCache {
  const shared = globalThis as HostCacheGlobal;
  shared[hostCacheKey] ??= { key: "", expiresAt: 0, snapshot: null, inFlight: null };
  return shared[hostCacheKey];
}

async function readRemoteHostSnapshot(): Promise<HostSnapshot> {
  const connection = remoteHermesConnection();
  if (!connection) throw new Error("Remote Hermes is not configured.");
  const cache = remoteCache();
  const key = `${connection.config.url}\n${connection.credentials.username}`;
  if (cache.key === key && cache.inFlight) return cache.inFlight;
  if (cache.key === key && cache.snapshot && cache.expiresAt > Date.now()) {
    return cache.snapshot;
  }

  const inFlight = (async () => {
    const sampledAt = Date.now();
    const stats = await remoteDashboardJson<HermesSystemStats>(
      connection,
      "/api/system/stats",
    );
    const snapshot = remoteHostSnapshot(stats, sampledAt, {
      now: Date.now(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    cache.key = key;
    cache.snapshot = snapshot;
    cache.expiresAt = Date.now() + REMOTE_CACHE_MS;
    return snapshot;
  })();
  cache.key = key;
  cache.inFlight = inFlight;
  try {
    return await inFlight;
  } finally {
    if (cache.inFlight === inFlight) cache.inFlight = null;
  }
}

async function readMemory(): Promise<HostSnapshot["memory"]> {
  let total = os.totalmem();
  let available = os.freemem();
  try {
    // os.freemem() is MemFree; MemAvailable is the honest "can be used" figure.
    const text = await readFile("/proc/meminfo", "utf8");
    const totalKb = /^MemTotal:\s+(\d+)\s+kB/m.exec(text);
    const availableKb = /^MemAvailable:\s+(\d+)\s+kB/m.exec(text);
    if (totalKb) total = Number(totalKb[1]) * 1024;
    if (availableKb) available = Number(availableKb[1]) * 1024;
  } catch {
    // Non-Linux hosts and hardened /proc keep the os fallback.
  }
  return { total, available: Math.min(Math.max(0, available), total) };
}

async function readDisk(): Promise<HostSnapshot["disk"]> {
  try {
    const stats = await statfs("/");
    const total = Number(stats.blocks) * Number(stats.bsize);
    const available = Number(stats.bavail) * Number(stats.bsize);
    return total > 0 ? { total, available } : null;
  } catch {
    return null;
  }
}

async function readLocalHostSnapshot(): Promise<HostSnapshot> {
  const cpus = os.cpus();
  const times = cpus.reduce(
    (total, cpu) => {
      const value = cpu.times;
      total.idle += value.idle;
      total.total += value.user + value.nice + value.sys + value.idle + value.irq;
      return total;
    },
    { idle: 0, total: 0 },
  );
  const load = os.loadavg();
  const [memory, disk] = await Promise.all([readMemory(), readDisk()]);
  const sampledAt = Date.now();
  return {
    source: "local",
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: {
      model: (cpus[0]?.model ?? "").trim(),
      cores: cpus.length,
      times,
    },
    load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    memory,
    disk,
    uptime: os.uptime(),
    kana: {
      uptime: process.uptime(),
      rss: process.memoryUsage().rss,
    },
    serverTime: {
      now: sampledAt,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    },
    sampledAt,
  };
}

/**
 * GET /api/kana/host
 *
 * A read-only snapshot for the host surfaces. It samples this Kana machine in
 * local mode and the configured remote Hermes dashboard's `/api/system/stats`
 * in remote mode. No input, no shell, and nothing persisted: the browser polls
 * it only while a host surface is mounted (the Settings Host card or the
 * desktop header widget).
 */
export const GET = withSession(async () => {
  try {
    const snapshot = remoteHermesIntent() === "remote"
      ? await readRemoteHostSnapshot()
      : await readLocalHostSnapshot();
    return Response.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 502);
  }
});
