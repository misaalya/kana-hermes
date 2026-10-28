export type HostCpuTimes = {
  idle: number;
  total: number;
};

export type HostSnapshot = {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  cpu: {
    model: string;
    cores: number;
    times: HostCpuTimes;
  };
  load: [number, number, number];
  memory: {
    total: number;
    available: number;
  };
  disk: {
    total: number;
    available: number;
  } | null;
  uptime: number;
  kana: {
    uptime: number;
    rss: number;
  };
  sampledAt: number;
};

/** One read-only sample of this machine; the route takes no input. */
export async function readHostSnapshot(signal?: AbortSignal): Promise<HostSnapshot> {
  const response = await fetch("/api/kana/host", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Host metrics unavailable (${response.status}).`);
  }
  return (await response.json()) as HostSnapshot;
}
