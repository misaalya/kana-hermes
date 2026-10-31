"use client";

import { useEffect, useRef, useState } from "react";
import { cpuPercent } from "@/lib/host/host-metrics";
import { readHostSnapshot, type HostSnapshot } from "@/lib/runtime/host-client";

const POLL_MS = 3_000;

export type HostReading = {
  snapshot: HostSnapshot | null;
  /** The browser's clock when the latest sample arrived. */
  receivedAt: number | null;
  cpu: number | null;
  error: boolean;
};

/**
 * One read-only host sample every three seconds while active. A reading newer
 * than `freshForMs` is reused when a surface reopens instead of asking again.
 */
export function useHostSnapshot(
  options: { active?: boolean; freshForMs?: number } = {},
): HostReading {
  const { active = true, freshForMs = 0 } = options;
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const previousCpu = useRef<HostSnapshot["cpu"]["times"] | null>(null);
  const lastSampleAt = useRef(0);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let controller: AbortController | null = null;
    const tick = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await readHostSnapshot(controller.signal);
        if (!live) return;
        setSnapshot(next);
        setReceivedAt(Date.now());
        lastSampleAt.current = Date.now();
        setCpu(
          typeof next.cpu.percent === "number"
            ? next.cpu.percent
            : cpuPercent(previousCpu.current, next.cpu.times),
        );
        previousCpu.current = next.cpu.times;
        setError(false);
      } catch (reason) {
        if (!live || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(true);
      }
    };
    if (Date.now() - lastSampleAt.current >= freshForMs) void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [active, freshForMs]);

  return { snapshot, receivedAt, cpu, error };
}
