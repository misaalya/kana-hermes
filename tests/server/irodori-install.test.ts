import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, ftruncateSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  downloadWithResume,
  huggingFaceCachedModel,
  inspectIrodoriInstall,
  removeIrodoriInstall,
} from "@/lib/server/irodori/install";
import { __setIrodoriPlatformForTests } from "@/lib/server/irodori/platform";
import { IrodoriLocalTtsProvider } from "@/lib/server/tts-provider/irodori-local-provider";
import {
  IRODORI_ASSETS_ARCHIVE,
  IRODORI_ENGINE_ARCHIVE,
  IRODORI_MODEL_FILE,
  irodoriInstallPaths,
} from "@/lib/server/irodori/release";
import { installFakeEngine, useSupportedPlatform } from "./irodori-fixtures";

const root = mkdtempSync(path.join(tmpdir(), "kana-irodori-install-"));
const previous = { data: process.env.KANA_DATA_DIR, hub: process.env.HF_HUB_CACHE };
const payload = Buffer.from(Array.from({ length: 64_000 }, (_, index) => index % 251));
let server: Server;
let baseUrl = "";
let ignoreRange = false;
const ranges: Array<string | undefined> = [];

before(async () => {
  process.env.KANA_DATA_DIR = path.join(root, "data");
  process.env.HF_HUB_CACHE = path.join(root, "hub");
  mkdirSync(process.env.KANA_DATA_DIR, { recursive: true });
  useSupportedPlatform();
  server = createServer((request, response) => {
    ranges.push(request.headers.range);
    const match = /^bytes=(\d+)-$/.exec(request.headers.range ?? "");
    if (match && !ignoreRange) {
      const start = Number(match[1]);
      response.writeHead(206, { "Content-Length": payload.length - start });
      response.end(payload.subarray(start));
      return;
    }
    response.writeHead(200, { "Content-Length": payload.length });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`;
});

after(async () => {
  __setIrodoriPlatformForTests(null);
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of [["KANA_DATA_DIR", previous.data], ["HF_HUB_CACHE", previous.hub]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("resumable downloads", () => {
  it("continues a partial file with a range request", async () => {
    const partial = path.join(root, "resume.partial");
    writeFileSync(partial, payload.subarray(0, 20_000));
    ranges.length = 0;
    let reported = 0;
    await downloadWithResume(baseUrl, partial, payload.length, new AbortController().signal, (bytes) => {
      reported += bytes;
    });
    assert.deepEqual(ranges, ["bytes=20000-"]);
    assert.deepEqual(readFileSync(partial), payload);
    assert.equal(reported, payload.length, "progress includes the bytes already on disk");
  });

  it("starts over when the server ignores the range instead of corrupting the file", async () => {
    const partial = path.join(root, "ignored.partial");
    writeFileSync(partial, Buffer.from("stale bytes from an older attempt"));
    ignoreRange = true;
    try {
      await downloadWithResume(baseUrl, partial, payload.length, new AbortController().signal, () => undefined);
    } finally {
      ignoreRange = false;
    }
    assert.deepEqual(readFileSync(partial), payload);
  });

  it("rejects a body larger than the pinned size", async () => {
    const partial = path.join(root, "oversized.partial");
    await assert.rejects(
      downloadWithResume(baseUrl, partial, payload.length - 1, new AbortController().signal, () => undefined),
      /larger than the pinned file size/,
    );
  });

  it("stops when cancelled and keeps the partial file for next time", async () => {
    const partial = path.join(root, "cancelled.partial");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      downloadWithResume(baseUrl, partial, payload.length, controller.signal, () => undefined),
      /cancelled/,
    );
  });
});

describe("install state", () => {
  it("reports the full download when nothing is installed", () => {
    const status = inspectIrodoriInstall();
    assert.equal(status.state, "not_installed");
    assert.equal(status.engineInstalled, false);
    assert.equal(status.modelInstalled, false);
    assert.equal(
      status.downloadBytes,
      IRODORI_ENGINE_ARCHIVE.sizeBytes + IRODORI_ASSETS_ARCHIVE.sizeBytes + IRODORI_MODEL_FILE.sizeBytes,
    );
    assert.ok(status.requiredDiskBytes > status.downloadBytes, "extracted engine files need room too");
  });

  it("does not download the model again when the Hugging Face cache already has it", () => {
    const cached = huggingFaceCachedModel();
    mkdirSync(path.dirname(cached), { recursive: true });
    // A sparse file with the pinned size: detection must not read or hash it.
    const handle = openSync(cached, "w");
    ftruncateSync(handle, IRODORI_MODEL_FILE.sizeBytes);
    closeSync(handle);
    const status = inspectIrodoriInstall();
    assert.equal(status.downloadBytes, IRODORI_ENGINE_ARCHIVE.sizeBytes + IRODORI_ASSETS_ARCHIVE.sizeBytes);
  });

  it("is ready with an installed engine and a configured model, and removal keeps user files", async () => {
    const dataRoot = process.env.KANA_DATA_DIR!;
    installFakeEngine(dataRoot);
    const configuredModel = path.join(root, "my-model.safetensors");
    writeFileSync(configuredModel, "model");
    writeFileSync(path.join(dataRoot, "config.json"), JSON.stringify({ tts: { irodoriLocal: { modelPath: configuredModel } } }));
    const status = inspectIrodoriInstall();
    assert.equal(status.state, "ready");
    assert.equal(status.modelSource, "config");
    assert.equal(status.downloadBytes, 0);

    await removeIrodoriInstall();
    assert.equal(inspectIrodoriInstall().engineInstalled, false);
    assert.equal(existsSync(configuredModel), true, "a model named in config.json belongs to the user");
    assert.equal(existsSync(huggingFaceCachedModel()), true, "the Hugging Face cache belongs to the user");
  });

  it("explains an unsupported host instead of offering a download", () => {
    __setIrodoriPlatformForTests({ supported: false, reason: "Local Irodori voice needs Linux on x86-64.", int8: false, physicalCores: 1 });
    const status = inspectIrodoriInstall();
    assert.equal(status.state, "unsupported");
    assert.match(status.message, /Linux on x86-64/);
    useSupportedPlatform();
  });

  it("tells setup screens whether a download would help", async () => {
    const provider = new IrodoriLocalTtsProvider();
    assert.equal((await provider.inspect()).installRequired, true);
    __setIrodoriPlatformForTests({ supported: false, reason: "Local Irodori voice needs Linux on x86-64.", int8: false, physicalCores: 1 });
    try {
      const status = await provider.inspect();
      assert.equal(status.state, "unavailable");
      assert.equal(status.installRequired, false, "an unsupported host has nothing to download");
    } finally {
      useSupportedPlatform();
    }
  });

  it("reports unfinished downloads so they can be removed", async () => {
    const paths = irodoriInstallPaths({ dataRoot: process.env.KANA_DATA_DIR! });
    mkdirSync(paths.downloads, { recursive: true });
    mkdirSync(paths.modelDirectory, { recursive: true });
    writeFileSync(path.join(paths.downloads, "engine.partial"), Buffer.alloc(1000));
    writeFileSync(`${paths.modelFile}.partial`, Buffer.alloc(500));
    const status = inspectIrodoriInstall();
    assert.equal(status.state, "not_installed");
    assert.equal(status.engineInstalled, false);
    assert.equal(status.partialDownloadBytes, 1500);

    await removeIrodoriInstall();
    assert.equal(inspectIrodoriInstall().partialDownloadBytes, 0);
  });
});
