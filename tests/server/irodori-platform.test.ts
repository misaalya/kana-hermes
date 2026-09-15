import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countPhysicalCores, detectIrodoriPlatform } from "@/lib/server/irodori/platform";
import { concatenatePcmWavs, encodePcmWav, parsePcmWav } from "@/lib/server/irodori/wav";

const cpuinfo = (flags: string) =>
  [0, 1, 2, 3]
    .map((processor) => `processor\t: ${processor}\nphysical id\t: 0\ncore id\t\t: ${processor % 2}\nflags\t\t: ${flags}\n`)
    .join("\n");

const linux = { platform: "linux" as const, arch: "x64", glibcVersion: "2.35", logicalCpus: 4 };

describe("Irodori host detection", () => {
  it("enables int8 only with AVX-512 VNNI and counts physical cores", () => {
    const vnni = detectIrodoriPlatform({ ...linux, cpuinfo: cpuinfo("fpu avx2 fma avx512f avx512_vnni") });
    assert.deepEqual(vnni, { supported: true, reason: null, int8: true, physicalCores: 2 });
    const avx2 = detectIrodoriPlatform({ ...linux, cpuinfo: cpuinfo("fpu avx2 fma") });
    assert.equal(avx2.supported, true);
    assert.equal(avx2.int8, false);
  });

  it("explains why the prebuilt engine cannot run", () => {
    assert.match(detectIrodoriPlatform({ ...linux, platform: "darwin", cpuinfo: "" }).reason ?? "", /Linux on x86-64/);
    assert.match(detectIrodoriPlatform({ ...linux, arch: "arm64", cpuinfo: "" }).reason ?? "", /Linux on x86-64/);
    assert.match(detectIrodoriPlatform({ ...linux, glibcVersion: "2.31", cpuinfo: cpuinfo("avx2 fma") }).reason ?? "", /glibc 2\.35/);
    assert.match(detectIrodoriPlatform({ ...linux, glibcVersion: null, cpuinfo: cpuinfo("avx2 fma") }).reason ?? "", /glibc/);
    assert.match(detectIrodoriPlatform({ ...linux, cpuinfo: cpuinfo("sse4_2 avx") }).reason ?? "", /AVX2 and FMA/);
    assert.equal(detectIrodoriPlatform({ ...linux, glibcVersion: "2.39", cpuinfo: cpuinfo("avx2 fma") }).supported, true);
  });

  it("falls back to half the logical CPUs when topology is hidden", () => {
    assert.equal(countPhysicalCores("flags : avx2\n", 8), 4);
    assert.equal(countPhysicalCores("", 1), 1);
  });
});

describe("engine WAV joining", () => {
  const format = { sampleRate: 48_000, channels: 1, bitsPerSample: 16 };
  const wav = (...samples: number[]) => {
    const data = new Uint8Array(new Int16Array(samples).buffer);
    return new Uint8Array(encodePcmWav(format, data));
  };

  it("round-trips PCM and joins parts with a short silence", () => {
    const joined = parsePcmWav(new Uint8Array(concatenatePcmWavs([wav(1, 2), wav(3)], 0.001)));
    assert.equal(joined.sampleRate, 48_000);
    const samples = new Int16Array(joined.data.slice().buffer);
    // 48 samples of silence (1 ms at 48 kHz) between the parts.
    assert.equal(samples.length, 2 + 48 + 1);
    assert.deepEqual([samples[0], samples[1], samples[2], samples[49], samples[50]], [1, 2, 0, 0, 3]);
  });

  it("refuses to join parts with different formats or non-WAV output", () => {
    const other = new Uint8Array(encodePcmWav({ ...format, sampleRate: 24_000 }, new Uint8Array(4)));
    assert.throws(() => concatenatePcmWavs([wav(1), other]), /different audio formats/);
    assert.throws(() => parsePcmWav(new TextEncoder().encode("not a wav at all")), /did not produce a WAV/);
  });
});
