import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import type { HostSnapshot } from "@/lib/runtime/host-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * GET /api/kana/host
 *
 * A read-only snapshot of the machine Kana runs on. No input, no shell, and
 * nothing persisted: the browser polls it only while the Host panel is open.
 */
export const GET = withSession(async () => {
  try {
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
    const snapshot: HostSnapshot = {
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
      sampledAt: Date.now(),
    };
    return Response.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 500);
  }
});
