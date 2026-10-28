"use client";

import { useEffect, useRef, useState } from "react";
import { cpuPercent } from "@/lib/host/host-metrics";
import { readHostSnapshot, type HostSnapshot } from "@/lib/runtime/host-client";

const POLL_MS = 3_000;

export type HostReading = {
  snapshot: HostSnapshot | null;
  cpu: number | null;
  error: boolean;
};

/** One read-only host sample every three seconds, only while mounted. */
export function useHostSnapshot(): HostReading {
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

  return { snapshot, cpu, error };
}
