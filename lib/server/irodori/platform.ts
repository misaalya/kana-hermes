import { readFileSync } from "node:fs";
import os from "node:os";

// Host checks for the prebuilt irodori-c release: Linux x86-64 with glibc
// 2.35+ and the x86-64-v3 baseline (AVX2 + FMA). The int8 DiT/codec paths
// additionally need AVX-512 VNNI; without it the FP32 OpenBLAS binary is used.

export type IrodoriPlatform = {
  supported: boolean;
  /** Why the release cannot run here; null when supported. */
  reason: string | null;
  /** AVX-512 VNNI present, so the oneMKL int8 paths are safe to request. */
  int8: boolean;
  /** Physical cores, the thread count the engine documentation recommends. */
  physicalCores: number;
};

type PlatformInput = {
  platform: NodeJS.Platform;
  arch: string;
  glibcVersion: string | null;
  cpuinfo: string;
  logicalCpus: number;
};

const MINIMUM_GLIBC = [2, 35] as const;

function glibcAtLeast(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MINIMUM_GLIBC[0] || (major === MINIMUM_GLIBC[0] && minor >= MINIMUM_GLIBC[1]);
}

function cpuFlags(cpuinfo: string): Set<string> {
  const line = cpuinfo.split("\n").find((entry) => /^flags\s*:/.test(entry));
  return new Set(line ? line.split(":", 2)[1].trim().split(/\s+/) : []);
}

/** Count distinct (physical id, core id) pairs; falls back to half the logical CPUs. */
export function countPhysicalCores(cpuinfo: string, logicalCpus: number): number {
  const cores = new Set<string>();
  let physicalId = "0";
  for (const line of cpuinfo.split("\n")) {
    const [key, value] = line.split(":").map((part) => part?.trim());
    if (key === "physical id") physicalId = value ?? "0";
    if (key === "core id") cores.add(`${physicalId}:${value}`);
  }
  if (cores.size > 0) return cores.size;
  return Math.max(1, Math.floor(logicalCpus / 2) || 1);
}

export function detectIrodoriPlatform(input: PlatformInput): IrodoriPlatform {
  const physicalCores = countPhysicalCores(input.cpuinfo, input.logicalCpus);
  const unsupported = (reason: string): IrodoriPlatform => ({ supported: false, reason, int8: false, physicalCores });
  if (input.platform !== "linux" || input.arch !== "x64") {
    return unsupported("Local Irodori voice needs Linux on x86-64; use an OpenAI-compatible voice provider on this machine.");
  }
  if (!glibcAtLeast(input.glibcVersion)) {
    return unsupported(`Local Irodori voice needs glibc ${MINIMUM_GLIBC.join(".")} or newer (Ubuntu 22.04+).`);
  }
  const flags = cpuFlags(input.cpuinfo);
  if (!flags.has("avx2") || !flags.has("fma")) {
    return unsupported("Local Irodori voice needs a CPU with AVX2 and FMA (x86-64-v3).");
  }
  return { supported: true, reason: null, int8: flags.has("avx512_vnni"), physicalCores };
}

let cached: IrodoriPlatform | null = null;

/** Test hook: pretend the host has (or lacks) the engine's CPU features. */
export function __setIrodoriPlatformForTests(platform: IrodoriPlatform | null): void {
  cached = platform;
}

export function currentIrodoriPlatform(): IrodoriPlatform {
  if (cached) return cached;
  let cpuinfo = "";
  try {
    cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
  } catch {
    // Non-Linux hosts are rejected by the platform check below.
  }
  const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined;
  cached = detectIrodoriPlatform({
    platform: process.platform,
    arch: process.arch,
    glibcVersion: report?.header?.glibcVersionRuntime ?? null,
    cpuinfo,
    logicalCpus: os.availableParallelism(),
  });
  return cached;
}
