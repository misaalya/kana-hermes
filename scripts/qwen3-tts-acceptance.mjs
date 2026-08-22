import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";

const SERVICE_NAME = "kana-qwen3-tts";
const API_VERSION = "1";
const DEFAULT_URL = "http://127.0.0.1:7860";

const PROFILES = [
  {
    id: "short",
    text: "こんにちは。カナの短い音声テストです。",
  },
  {
    id: "medium",
    text: "こんにちは。これはカナの音声速度を測るための、中くらいの長さの日本語サンプルです。落ち着いた自然な声で読み上げます。",
  },
  {
    id: "long",
    text: "こんにちは。これはカナの長い音声応答を想定したベンチマークです。ユーザーとの会話では、短い返事だけでなく、作業の進み具合や大切な注意点を分かりやすく説明することがあります。そのような場合でも、音声の生成順序が保たれ、途中で停止したときに古い音声が再生されず、聞き取りやすい日本語として安定して返されることを確認します。",
  },
];

function parseInteger(value, label, minimum = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.KANA_TTS_BASE_URL || DEFAULT_URL,
    voiceId: process.env.KANA_TTS_VOICE_ID || "ono_anna",
    warmup: 1,
    runs: 20,
    waitSeconds: 900,
    requestTimeoutSeconds: 900,
    cancellation: true,
    cancellationDelayMs: 250,
    output: "qwen3-tts-acceptance.json",
    hardware: process.env.KANA_TTS_HARDWARE || "",
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      return value;
    };
    if (argument === "--url") options.baseUrl = next();
    else if (argument === "--voice") options.voiceId = next();
    else if (argument === "--warmup") options.warmup = parseInteger(next(), argument);
    else if (argument === "--runs") options.runs = parseInteger(next(), argument, 1);
    else if (argument === "--wait-seconds") {
      options.waitSeconds = parseInteger(next(), argument);
    } else if (argument === "--request-timeout-seconds") {
      options.requestTimeoutSeconds = parseInteger(next(), argument, 1);
    } else if (argument === "--cancel-delay-ms") {
      options.cancellationDelayMs = parseInteger(next(), argument);
    } else if (argument === "--output") options.output = next();
    else if (argument === "--hardware") options.hardware = next();
    else if (argument === "--skip-cancellation") options.cancellation = false;
    else if (argument === "--self-test") options.selfTest = true;
    else if (argument === "--help") {
      process.stdout.write(`Usage: node scripts/qwen3-tts-acceptance.mjs [options]\n\n`);
      process.stdout.write(`  --url URL                       Service base URL\n`);
      process.stdout.write(`  --voice ID                      Qwen speaker ID\n`);
      process.stdout.write(`  --warmup N                      Warm-up requests per profile (default: 1)\n`);
      process.stdout.write(`  --runs N                        Measured requests per profile (default: 20)\n`);
      process.stdout.write(`  --wait-seconds N                Maximum model-ready wait (default: 900)\n`);
      process.stdout.write(`  --request-timeout-seconds N     Per-request timeout (default: 900)\n`);
      process.stdout.write(`  --cancel-delay-ms N             Delay before cancellation (default: 250)\n`);
      process.stdout.write(`  --skip-cancellation              Skip active cancellation acceptance\n`);
      process.stdout.write(`  --hardware TEXT                  Human-readable VPS/GPU description\n`);
      process.stdout.write(`  --output PATH                    JSON evidence path\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value.trim() || DEFAULT_URL);
  const localhost = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localhost)) {
    throw new Error("Use HTTPS, or localhost HTTP when running the acceptance harness on the VPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("The Qwen3-TTS URL must not contain credentials.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function parseWav(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    throw new Error("Speech response is not a RIFF/WAVE file.");
  }

  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = text(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + chunkSize > bytes.byteLength) {
      throw new Error(`WAV chunk ${chunkId} extends past the response body.`);
    }
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    }
    if (chunkId === "data") dataBytes = chunkSize;
    offset = body + chunkSize + (chunkSize % 2);
  }
  if (!format || dataBytes === null || format.byteRate <= 0 || dataBytes <= 0) {
    throw new Error("WAV response has no usable format or audio data chunk.");
  }
  return {
    ...format,
    dataBytes,
    durationMs: (dataBytes / format.byteRate) * 1000,
    fileBytes: bytes.byteLength,
  };
}

function summarize(samples) {
  const synthesis = samples.map((sample) => sample.synthesisMs);
  const audio = samples.map((sample) => sample.audioDurationMs);
  const rtf = samples.map((sample) => sample.realTimeFactor);
  return {
    count: samples.length,
    synthesisMs: {
      min: round(Math.min(...synthesis)),
      p50: round(percentile(synthesis, 0.5)),
      p95: round(percentile(synthesis, 0.95)),
      max: round(Math.max(...synthesis)),
    },
    audioDurationMs: {
      p50: round(percentile(audio, 0.5)),
      p95: round(percentile(audio, 0.95)),
    },
    realTimeFactor: {
      p50: round(percentile(rtf, 0.5), 3),
      p95: round(percentile(rtf, 0.95), 3),
    },
  };
}

function makeTestWav() {
  const buffer = new ArrayBuffer(48);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const put = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  put(0, "RIFF");
  view.setUint32(4, 40, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, 4, true);
  return buffer;
}

function selfTest() {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 3.8499999999999996);
  const wav = parseWav(makeTestWav());
  assert.equal(wav.sampleRate, 24_000);
  assert.equal(wav.channels, 1);
  assert.equal(round(wav.durationMs, 4), 0.0833);
  const report = summarize([
    { synthesisMs: 100, audioDurationMs: 200, realTimeFactor: 0.5 },
    { synthesisMs: 300, audioDurationMs: 400, realTimeFactor: 0.75 },
  ]);
  assert.equal(report.synthesisMs.p50, 200);
  process.stdout.write("Qwen3-TTS acceptance harness self-test passed.\n");
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function waitUntilReady(baseUrl, waitMs) {
  const deadline = Date.now() + waitMs;
  let last = null;
  while (Date.now() <= deadline) {
    last = await getJson(`${baseUrl}/v1/health`, Math.min(waitMs, 15_000));
    if (last.status === "ready") return last;
    if (last.status === "error") {
      throw new Error(`Qwen3-TTS failed to load: ${last.error || "unknown error"}`);
    }
    process.stdout.write("Qwen3-TTS is still loading; checking again in 2 seconds…\n");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Qwen3-TTS did not become ready. Last status: ${last?.status || "unreachable"}.`);
}

async function requestSpeech(baseUrl, voiceId, text, timeoutMs) {
  const requestId = `kana-acceptance-${randomUUID()}`;
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/v1/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kana-Request-Id": requestId,
    },
    body: JSON.stringify({
      text,
      language: "ja",
      voice_id: voiceId,
      emotion: "neutral",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const synthesisMs = performance.now() - startedAt;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Speech request returned HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const audio = await response.arrayBuffer();
  const wav = parseWav(audio);
  const responseRequestId = response.headers.get("x-kana-request-id");
  const responseVoiceId = response.headers.get("x-kana-voice-id");
  const responseSampleRate = Number(response.headers.get("x-kana-sample-rate"));
  if (responseRequestId !== requestId) throw new Error("Speech response request ID does not match.");
  if (!responseVoiceId) throw new Error("Speech response has no X-Kana-Voice-Id header.");
  if (responseSampleRate !== wav.sampleRate) {
    throw new Error("Speech response sample-rate header does not match the WAV.");
  }
  return {
    requestId,
    synthesisMs: round(synthesisMs),
    audioDurationMs: round(wav.durationMs),
    realTimeFactor: round(synthesisMs / wav.durationMs, 4),
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    fileBytes: wav.fileBytes,
  };
}

async function verifyCancellation(baseUrl, voiceId, delayMs, timeoutMs) {
  const requestId = `kana-cancel-${randomUUID()}`;
  const longText = `${PROFILES[2].text}`.repeat(4).slice(0, 1_100);
  const speech = fetch(`${baseUrl}/v1/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kana-Request-Id": requestId,
    },
    body: JSON.stringify({
      text: longText,
      language: "ja",
      voice_id: voiceId,
      emotion: "neutral",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const cancelResponse = await fetch(
    `${baseUrl}/v1/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "POST", signal: AbortSignal.timeout(15_000) },
  );
  const cancelBody = await cancelResponse.json();
  const speechResponse = await speech;
  const passed =
    cancelResponse.ok &&
    cancelBody.cancelled === true &&
    cancelBody.was_active === true &&
    speechResponse.status === 499;
  return {
    passed,
    requestId,
    cancelHttpStatus: cancelResponse.status,
    speechHttpStatus: speechResponse.status,
    wasActive: cancelBody.was_active === true,
    note: passed
      ? "The active request was acknowledged and ended with the service cancellation status."
      : "Cancellation was not observed while synthesis was active. Retry with a shorter delay or inspect the service logs.",
  };
}

async function main(options) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.requestTimeoutSeconds * 1000;
  const setup = await getJson(`${baseUrl}/v1/setup`, 15_000);
  const health = await waitUntilReady(baseUrl, options.waitSeconds * 1000);
  const voices = await getJson(`${baseUrl}/v1/voices`, 15_000);

  if (health.service !== SERVICE_NAME || health.api_version !== API_VERSION) {
    throw new Error(`Expected ${SERVICE_NAME} API v${API_VERSION}.`);
  }
  if (!Array.isArray(voices.voices) || !voices.voices.some((voice) => voice.id === options.voiceId)) {
    throw new Error(`Voice '${options.voiceId}' is not present in /v1/voices.`);
  }

  const profiles = {};
  for (const profile of PROFILES) {
    process.stdout.write(`Benchmarking ${profile.id} Japanese text (${profile.text.length} characters)…\n`);
    for (let index = 0; index < options.warmup; index += 1) {
      await requestSpeech(baseUrl, options.voiceId, profile.text, timeoutMs);
    }
    const samples = [];
    for (let index = 0; index < options.runs; index += 1) {
      const sample = await requestSpeech(baseUrl, options.voiceId, profile.text, timeoutMs);
      samples.push(sample);
      process.stdout.write(
        `  ${index + 1}/${options.runs}: ${sample.synthesisMs} ms, ${sample.audioDurationMs} ms audio, RTF ${sample.realTimeFactor}\n`,
      );
    }
    profiles[profile.id] = {
      characters: profile.text.length,
      warmupRequests: options.warmup,
      summary: summarize(samples),
      samples,
    };
  }

  const cancellation = options.cancellation
    ? await verifyCancellation(
        baseUrl,
        options.voiceId,
        options.cancellationDelayMs,
        timeoutMs,
      )
    : { passed: null, skipped: true, note: "Cancellation was skipped by command-line option." };
  const baselineComplete = options.runs >= 20;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    service: {
      baseUrl,
      name: health.service,
      apiVersion: health.api_version,
      model: health.model,
      revision: health.revision ?? null,
      device: health.device,
      dtype: health.dtype,
      loadedSeconds: health.loaded_seconds ?? null,
      voiceId: options.voiceId,
      setup,
    },
    hardware: {
      description: options.hardware || null,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model || "unknown",
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytesAtStart: os.freemem(),
    },
    profiles,
    cancellation,
    acceptance: {
      contractPassed: true,
      baselineComplete,
      cancellationPassed: cancellation.passed,
      passed: baselineComplete && cancellation.passed === true,
      note: baselineComplete
        ? "Latency is recorded evidence, not a realtime performance promise. Listen to one WAV separately for intelligibility."
        : "Run at least 20 measured requests per profile before using this as the target-hardware baseline.",
    },
  };
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`\nEvidence written to ${options.output}\n`);
  process.stdout.write(`${JSON.stringify(report.acceptance, null, 2)}\n`);
  if (!report.acceptance.passed) process.exitCode = 2;
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) selfTest();
else await main(options);
