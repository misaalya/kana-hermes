import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { __setIrodoriPlatformForTests } from "@/lib/server/irodori/platform";
import {
  IRODORI_ASSET_MEMBERS,
  IRODORI_ASSETS_ARCHIVE,
  IRODORI_ENGINE_ARCHIVE,
  IRODORI_ENGINE_MARKER,
  IRODORI_ENGINE_MEMBERS,
  irodoriInstallPaths,
} from "@/lib/server/irodori/release";

/**
 * A stand-in engine: a Node script with the real CLI's shape. It writes a
 * short 48 kHz mono WAV to --out, records its arguments, and honours a few
 * behaviours driven by the text so tests can exercise failure and hangs.
 */
const FAKE_ENGINE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const text = value("--text");
// The engine runs with a minimal environment, so the log sits next to its output folder.
fs.appendFileSync(require("node:path").join(value("--out"), "..", "..", "fake-engine.log"), JSON.stringify({ args, threads: process.env.IRO_NUM_THREADS, start: Date.now() }) + "\\n");
if (text.includes("FAIL")) { console.error("tokenizer: text exceeds 256 tokens"); process.exit(3); }
const finish = () => {
  const samples = Buffer.alloc(480 * 2);
  samples.writeInt16LE(Math.min(text.length, 32767), 0);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + samples.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(samples.length, 40);
  fs.writeFileSync(value("--out"), Buffer.concat([header, samples]));
};
if (text.includes("SLOW")) setTimeout(finish, 30000); else setTimeout(finish, 40);
`;

export function useSupportedPlatform(int8 = true): void {
  __setIrodoriPlatformForTests({ supported: true, reason: null, int8, physicalCores: 2 });
}

/** Lay out an "installed" engine with fake binaries under `<dataRoot>/irodori`. */
export function installFakeEngine(dataRoot: string): { engineDirectory: string; log: string } {
  const paths = irodoriInstallPaths({ dataRoot });
  for (const member of [...IRODORI_ENGINE_MEMBERS, ...IRODORI_ASSET_MEMBERS]) {
    const target = path.join(paths.engineDirectory, member);
    mkdirSync(path.dirname(target), { recursive: true });
    if (member === "lib" || member === "licenses") mkdirSync(target, { recursive: true });
    else writeFileSync(target, member.startsWith("bin/") ? FAKE_ENGINE : "fixture");
    if (member.startsWith("bin/")) chmodSync(target, 0o755);
  }
  writeFileSync(
    path.join(paths.engineDirectory, IRODORI_ENGINE_MARKER),
    JSON.stringify({ engineSha256: IRODORI_ENGINE_ARCHIVE.sha256, assetsSha256: IRODORI_ASSETS_ARCHIVE.sha256 }),
  );
  const log = path.join(paths.root, "fake-engine.log");
  writeFileSync(log, "");
  return { engineDirectory: paths.engineDirectory, log };
}
