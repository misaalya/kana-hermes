#!/usr/bin/env node
// Kana Qwen3-TTS service v2 — thin HTTP boundary around the pure-C engine
// (github.com/gabriele-mastrapasqua/qwen3-tts, MIT).
//
// Zero npm dependencies: Node stdlib only. Inference runs in the engine's own
// process (one CLI invocation per speech request), never inside Next.js.
//
// Contract mirrors the previous Python service so the browser relay,
// provider, and acceptance harness keep working unchanged:
//   GET    /v1/health
//   GET    /v1/setup
//   GET    /v1/voices
//   POST   /v1/voices/clone          {name,audio_base64,reference_text?,x_vector_only?,consent}
//   DELETE /v1/voices?id=<id>        (relay maps DELETE voices to query param)
//   POST   /v1/speech                {text,language?,voice_id?,emotion?} -> audio/wav
//   POST   /v1/requests/<id>/cancel
//
// Environment:
//   KANA_TTS_HOST/KANA_TTS_PORT      bind address (default 127.0.0.1:7860)
//   KANA_TTS_ENGINE_DIR              engine checkout with ./qwen_tts binary
//                                    (default ~/.local/share/kana/qwen3-tts-engine)
//   KANA_TTS_ENGINE_BIN              explicit qwen_tts binary path (wins)
//   KANA_TTS_MODEL_DIR               Base model directory
//                                    (default <engine>/qwen3-tts-0.6b-base)
//   KANA_TTS_DATA_DIR                profiles root (default ~/.local/share/kana/qwen3-tts)
//   KANA_TTS_ENGINE_JOBS             engine -j worker threads (default 2)
//   KANA_TTS_MAX_SYNTH_SECONDS       hard kill guard (default 300)

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_VERSION = "2";
const SERVICE = "kana-qwen3-tts";
const SAMPLE_RATE = 24000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const HOST = process.env.KANA_TTS_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.KANA_TTS_PORT || 7860);
const HOME = os.homedir();
const ENGINE_DIR =
  process.env.KANA_TTS_ENGINE_DIR?.trim() ||
  path.join(HOME, ".local/share/kana/qwen3-tts-engine");
const ENGINE_BIN =
  process.env.KANA_TTS_ENGINE_BIN?.trim() || path.join(ENGINE_DIR, "qwen_tts");
const MODEL_DIR =
  process.env.KANA_TTS_MODEL_DIR?.trim() ||
  path.join(ENGINE_DIR, "qwen3-tts-0.6b-base");
const DATA_DIR =
  process.env.KANA_TTS_DATA_DIR?.trim() ||
  path.join(HOME, ".local/share/kana/qwen3-tts");
const VOICES_DIR = path.join(DATA_DIR, "voices");
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_VOICE_ASSET = path.join(SERVICE_DIR, "assets", "kana.wav");
const BUILTIN_VOICE_ID = "builtin-kana";
const ENGINE_JOBS = Math.max(1, Number(process.env.KANA_TTS_ENGINE_JOBS || 2));
// Measured on the 4-vCPU EPYC reference host: -j2 --int8 lands at RTF ~0.92
// (sub-realtime) versus ~1.24 bf16. Empty string disables quantization.
const ENGINE_QUANT =
  process.env.KANA_TTS_ENGINE_QUANT !== undefined
    ? process.env.KANA_TTS_ENGINE_QUANT.trim()
    : "int8";
const MAX_SYNTH_SECONDS = Math.max(
  10,
  Number(process.env.KANA_TTS_MAX_SYNTH_SECONDS || 300),
);

const LANGUAGES = [
  "auto", "chinese", "english", "french", "german", "italian",
  "japanese", "korean", "portuguese", "russian", "spanish",
];

const startedAt = Date.now();
const inflight = new Map(); // requestId -> {child, tmpWav, timer}
let synthChain = Promise.resolve();

function log(...parts) {
  process.stdout.write(`[${new Date().toISOString()}] ${parts.join(" ")}\n`);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { statusCode: 400 });
  }
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...options.spawn,
    });
    options.onSpawn?.(child);
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: String(error) });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? -2, signal, stderr });
    });
  });
}

function ffprobeSeconds(file) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    child.stdout?.on("data", (c) => { out += c; });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      const value = Number.parseFloat(out.trim());
      resolve(code === 0 && Number.isFinite(value) ? value : null);
    });
  });
}

function ensureDirs() {
  fs.mkdirSync(VOICES_DIR, { recursive: true, mode: 0o700 });
}

function engineReady() {
  try {
    return (
      fs.existsSync(ENGINE_BIN) &&
      fs.statSync(ENGINE_BIN).isFile() &&
      fs.existsSync(path.join(MODEL_DIR, "model.safetensors"))
    );
  } catch {
    return false;
  }
}

function listVoiceMetas() {
  ensureDirs();
  const metas = [];
  for (const entry of fs.readdirSync(VOICES_DIR)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(VOICES_DIR, entry), "utf8"),
      );
      if (meta && typeof meta.id === "string") metas.push(meta);
    } catch (error) {
      log(`warn: unreadable voice meta ${entry}: ${error.message}`);
    }
  }
  metas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return metas;
}

function defaultVoiceId(metas) {
  return metas.length ? metas[metas.length - 1].id : "";
}

// Fresh installs ship with a built-in "Kana" voice (assets/kana.wav). The
// first time the voices directory is empty and the engine is available, the
// reference clip is cloned once into a regular profile so it behaves exactly
// like a user-created clone afterwards (deletable, replaceable).
let builtinProvisioned = false;
async function ensureBuiltinVoice() {
  if (builtinProvisioned) return;
  if (!fs.existsSync(BUILTIN_VOICE_ASSET) || !engineReady()) return;
  if (listVoiceMetas().length > 0) {
    builtinProvisioned = true;
    return;
  }
  ensureDirs();
  const id = BUILTIN_VOICE_ID;
  const profileFile = `${id}.qvoice`;
  const profilePath = path.join(VOICES_DIR, profileFile);
  const discardDir = fs.mkdtempSync(path.join(os.tmpdir(), "kana-builtin-"));
  log("provisioning built-in voice 'Kana' from assets/kana.wav…");
  const result = await run(
    ENGINE_BIN,
    [
      "-d", MODEL_DIR,
      "--ref-audio", BUILTIN_VOICE_ASSET,
      "-l", "Japanese",
      "--voice-name", "Kana",
      "--xvector-only",
      "--save-voice", profilePath,
      "--silent",
      "--text", "こんにちは。",
      "-o", path.join(discardDir, "discard.wav"),
    ],
    { timeoutMs: 600_000 },
  );
  try { fs.rmSync(discardDir, { recursive: true, force: true }); } catch {}
  if (result.code !== 0 || !fs.existsSync(profilePath)) {
    cleanup(profilePath);
    log(`built-in voice provisioning failed: ${lastLine(result.stderr)}`);
    return; // retried on the next speech request / restart
  }
  const duration = (await ffprobeSeconds(BUILTIN_VOICE_ASSET)) ?? 0;
  fs.writeFileSync(
    path.join(VOICES_DIR, `${id}.json`),
    JSON.stringify(
      {
        id,
        name: "Kana",
        audio_path: null,
        reference_text: null,
        x_vector_only: true,
        duration_seconds: Math.round(duration * 100) / 100,
        created_at: new Date().toISOString(),
        language: "ja",
        profile_file: profileFile,
        builtin: true,
        load_flags: JSON.stringify(["--xvector-only"]),
      },
      null,
      2,
    ),
  );
  builtinProvisioned = true;
  log(`built-in voice ready: ${profileFile}`);
}

function healthPayload() {
  const ready = engineReady();
  const metas = ready ? listVoiceMetas() : [];
  return {
    service: SERVICE,
    api_version: API_VERSION,
    status: ready ? "ready" : "loading",
    model: path.basename(MODEL_DIR),
    revision: null,
    device: "cpu-c",
    dtype: "bf16-mmap",
    speakers: [],
    languages: LANGUAGES,
    default_voice_id: defaultVoiceId(metas),
    supports_instruction: false,
    supports_voice_clone: true,
    model_type: "base",
    loaded_seconds: (Date.now() - startedAt) / 1000,
    error: ready ? null : `engine or model not found under ${ENGINE_DIR}`,
  };
}

async function setupPayload() {
  const result = {
    service: SERVICE,
    api_version: API_VERSION,
    cache_dir: ENGINE_DIR,
    cache_exists: fs.existsSync(ENGINE_DIR),
    model_cache_detected: fs.existsSync(path.join(MODEL_DIR, "model.safetensors")),
    free_disk_bytes: 0,
    total_disk_bytes: 0,
    recommended_free_disk_bytes: 4 * 1024 * 1024 * 1024,
    disk_sufficient: true,
  };
  try {
    const stats = await fs.promises.statfs(DATA_DIR);
    result.free_disk_bytes = stats.bsize * stats.bavail;
    result.total_disk_bytes = stats.bsize * stats.blocks;
    result.disk_sufficient = result.free_disk_bytes >= result.recommended_free_disk_bytes;
  } catch {
    // Path may not exist yet before first clone; zeros are honest enough.
  }
  return result;
}

function voicesPayload() {
  const metas = listVoiceMetas();
  return {
    service: SERVICE,
    api_version: API_VERSION,
    status: "ready",
    default_voice_id: defaultVoiceId(metas),
    supports_voice_clone: true,
    voices: metas.map((meta) => ({
      id: meta.id,
      name: meta.name,
      language: meta.language ?? "ja",
      kind: "cloned",
      duration_seconds: meta.duration_seconds ?? 0,
      created_at: meta.created_at,
      x_vector_only: Boolean(meta.x_vector_only),
    })),
  };
}

// The graft/.bin loading semantics differ between docs examples, so probe the
// modifier once per profile and remember what worked (persisted in meta).
function voiceFlagCandidates(meta) {
  if (meta.load_flags) return [meta.load_flags];
  const candidates = [[], ["--icl-only"], ["--xvector-only"]];
  if (meta.x_vector_only) {
    return [["--xvector-only"], [], ["--icl-only"]];
  }
  return candidates;
}

function rememberVoiceFlags(meta, flags) {
  if (meta.load_flags === JSON.stringify(flags)) return;
  meta.load_flags = JSON.stringify(flags);
  try {
    fs.writeFileSync(
      path.join(VOICES_DIR, `${meta.id}.json`),
      JSON.stringify(meta, null, 2),
    );
  } catch (error) {
    log(`warn: could not persist load_flags for ${meta.id}: ${error.message}`);
  }
}

function synthesizeWithEngine({ text, meta, outWav, onSpawn }) {
  const baseArgs = [
    "-d", MODEL_DIR,
    "-j", String(ENGINE_JOBS),
    "--silent",
    "--load-voice", path.join(VOICES_DIR, meta.profile_file ?? `${meta.id}.qvoice`),
  ];
  const flagSets = voiceFlagCandidates(meta);
  const attempt = async (index) => {
    if (index >= flagSets.length) {
      throw new Error("engine rejected every known voice-load mode");
    }
    const flags = flagSets[index];
    const args = [
      ...baseArgs.slice(0, 4),
      ...flags,
      ...baseArgs.slice(4),
      "-l", "Japanese",
      "-o", outWav,
      "--text", text,
    ];
    // Runtime quantization is this engine's main x86 lever: measured on the
    // 4-vCPU EPYC host, -j2 --int8 reaches RTF ~0.92 vs ~1.24 bf16.
    if (ENGINE_QUANT) {
      args.push(ENGINE_QUANT.startsWith("--") ? ENGINE_QUANT : `--${ENGINE_QUANT}`);
    }
    const started = timeMonotonic();
    const result = await run(ENGINE_BIN, args, {
      timeoutMs: MAX_SYNTH_SECONDS * 1000,
      onSpawn,
    });
    if (result.code === 0 && fs.existsSync(outWav)) {
      rememberVoiceFlags(meta, flags);
      log(`synthesized ${JSON.stringify(flags)} in ${round2(timeMonotonic() - started)}s (${text.length} chars)`);
      return;
    }
    log(`engine attempt ${index} failed (code=${result.code}): ${lastLine(result.stderr)}`);
    if (result.code === 143 || result.signal === "SIGTERM") {
      throw Object.assign(new Error("cancelled"), { cancelled: true });
    }
    await attempt(index + 1);
  };
  return attempt(0);
}

function timeMonotonic() {
  return performance.now() / 1000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function lastLine(text) {
  const lines = String(text || "").trim().split("\n");
  return lines[lines.length - 1].slice(0, 300);
}

function enqueueSynthesis(task) {
  const run = synthChain.then(task, task);
  synthChain = run.catch(() => undefined);
  return run;
}

async function handleSpeech(req, res, requestId) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.statusCode ?? 400, { detail: error.message });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return sendJson(res, 422, { detail: "text is required" });

  const metas = listVoiceMetas();
  if (metas.length === 0) {
    await ensureBuiltinVoice();
    metas.push(...listVoiceMetas());
  }
  const requestedId = body.voice_id ? String(body.voice_id) : defaultVoiceId(metas);
  const meta = metas.find((candidate) => candidate.id === requestedId);
  if (!meta) {
    return sendJson(res, 404, { detail: "voice profile not found" });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kana-tts-"));
  const outWav = path.join(tmpDir, "out.wav");
  const entryId = requestId || crypto.randomUUID();
  const entry = { child: null, tmpWav: outWav };
  let settled = false;

  const killInflight = () => {
    try { entry.child?.kill("SIGTERM"); } catch {}
  };
  req.on("close", () => { if (!settled) killInflight(); });
  inflight.set(entryId, entry);

  try {
    await enqueueSynthesis(async () => {
      if (settled) return;
      await synthesizeWithEngine({
        text,
        meta,
        outWav,
        onSpawn: (child) => { entry.child = child; },
      });
    });
    settled = true;
    inflight.delete(entryId);
    if (!fs.existsSync(outWav)) {
      return sendJson(res, 502, { detail: "engine produced no audio" });
    }
    const wav = fs.readFileSync(outWav);
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": wav.length,
      "Cache-Control": "no-store",
    });
    res.end(wav);
  } catch (error) {
    settled = true;
    inflight.delete(entryId);
    if (error.cancelled) {
      return sendJson(res, 503, { detail: "synthesis was cancelled" });
    }
    log(`speech failed: ${error.message}`);
    return sendJson(res, 502, { detail: `TTS synthesis failed: ${error.message}` });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function handleClone(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.statusCode ?? 400, { detail: error.message });
  }
  if (!body.consent) {
    return sendJson(res, 422, { detail: "cloning requires consent" });
  }
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) return sendJson(res, 422, { detail: "name is required" });
  if (typeof body.audio_base64 !== "string" || !body.audio_base64.length) {
    return sendJson(res, 422, { detail: "audio_base64 is required" });
  }
  let audio;
  try {
    audio = Buffer.from(body.audio_base64, "base64");
  } catch {
    return sendJson(res, 422, { detail: "audio_base64 is not valid base64" });
  }
  if (audio.length > 20 * 1024 * 1024) {
    return sendJson(res, 413, { detail: "reference audio exceeds 20 MB" });
  }

  ensureDirs();
  const id = `clone-${crypto.randomBytes(16).toString("hex")}`;
  const originalPath = path.join(VOICES_DIR, `${id}-upload.tmp`);
  fs.writeFileSync(originalPath, audio);

  const rate = await probeSampleRate(originalPath);
  let refPath = originalPath;
  if (rate === null) {
    cleanup(originalPath);
    return sendJson(res, 422, { detail: "reference audio is not decodable WAV" });
  }
  if (rate !== SAMPLE_RATE) {
    refPath = path.join(VOICES_DIR, `${id}.wav`);
    const converted = await run("ffmpeg", [
      "-y", "-i", originalPath,
      "-ar", String(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16",
      refPath,
    ]);
    cleanup(originalPath);
    if (converted.code !== 0 || !fs.existsSync(refPath)) {
      cleanup(refPath);
      return sendJson(res, 422, { detail: `reference audio must be convertible to ${SAMPLE_RATE} Hz WAV` });
    }
  } else {
    refPath = path.join(VOICES_DIR, `${id}.wav`);
    fs.renameSync(originalPath, refPath);
  }

  const duration = (await ffprobeSeconds(refPath)) ?? 0;
  const profileFile = `${id}.qvoice`;
  const profilePath = path.join(VOICES_DIR, profileFile);
  const discardDir = fs.mkdtempSync(path.join(os.tmpdir(), "kana-clone-"));
  const discardWav = path.join(discardDir, "discard.wav");

  const createResult = await run(
    ENGINE_BIN,
    [
      "-d", MODEL_DIR,
      "--ref-audio", refPath,
      "-l", "Japanese",
      "--voice-name", name,
      ...(body.x_vector_only === true ? ["--xvector-only"] : []),
      "--save-voice", profilePath,
      "--silent",
      "--text", "こんにちは。",
      "-o", discardWav,
    ],
    { timeoutMs: 600_000 },
  );
  cleanup(discardDir);

  if (createResult.code !== 0 || !fs.existsSync(profilePath)) {
    cleanup(profilePath);
    cleanup(refPath);
    log(`clone failed: ${lastLine(createResult.stderr)}`);
    return sendJson(res, 502, { detail: "voice cloning failed in the engine" });
  }

  const meta = {
    id,
    name,
    audio_path: path.basename(refPath),
    reference_text: typeof body.reference_text === "string" ? body.reference_text : null,
    x_vector_only: body.x_vector_only === true,
    duration_seconds: Math.round(duration * 100) / 100,
    created_at: new Date().toISOString(),
    language: "ja",
    profile_file: profileFile,
  };
  fs.writeFileSync(
    path.join(VOICES_DIR, `${id}.json`),
    JSON.stringify(meta, null, 2),
  );
  log(`cloned voice "${name}" as ${profileFile}`);
  return sendJson(res, 200, {
    service: SERVICE,
    api_version: API_VERSION,
    voice: {
      id,
      name,
      language: meta.language,
      kind: "cloned",
      duration_seconds: meta.duration_seconds,
      created_at: meta.created_at,
      x_vector_only: meta.x_vector_only,
    },
  });
}

function cleanup(file) {
  try { fs.rmSync(file, { force: true }); } catch {}
}

function probeSampleRate(file) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=sample_rate",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    child.stdout?.on("data", (c) => { out += c; });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      const value = Number.parseInt(out.trim(), 10);
      resolve(code === 0 && Number.isFinite(value) ? value : null);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === "GET /v1/health") {
      return sendJson(res, 200, healthPayload());
    }
    if (route === "GET /v1/setup") {
      return sendJson(res, 200, await setupPayload());
    }
    if (route === "GET /v1/voices") {
      return sendJson(res, 200, voicesPayload());
    }
    if (route === "POST /v1/voices/clone") {
      return await handleClone(req, res);
    }
    if (req.method === "DELETE" && url.pathname === "/v1/voices") {
      const id = url.searchParams.get("id") || "";
      const metas = listVoiceMetas();
      const meta = metas.find((candidate) => candidate.id === id);
      if (!meta) return sendJson(res, 404, { detail: "voice profile not found" });
      for (const suffix of [".json", ".wav", ".qvoice", ".bin"]) {
        cleanup(path.join(VOICES_DIR, `${id}${suffix}`));
      }
      cleanup(path.join(VOICES_DIR, `${id}-upload.tmp`));
      return sendJson(res, 200, { deleted: id });
    }
    if (route === "POST /v1/speech") {
      const requestId = req.headers["x-kana-request-id"];
      return await handleSpeech(req, res, typeof requestId === "string" ? requestId : undefined);
    }
    const cancelMatch = url.pathname.match(/^\/v1\/requests\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      const entry = inflight.get(decodeURIComponent(cancelMatch[1]));
      if (!entry) return sendJson(res, 404, { detail: "no such request" });
      try { entry.child?.kill("SIGTERM"); } catch {}
      return sendJson(res, 200, { cancelled: cancelMatch[1] });
    }
    return sendJson(res, 404, { detail: "Not Found" });
  } catch (error) {
    log(`handler error ${route}: ${error.stack || error.message}`);
    if (!res.headersSent) {
      sendJson(res, 500, { detail: "internal service error" });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  log(`${SERVICE} v${API_VERSION} listening on http://${HOST}:${PORT}`);
  log(`engine=${ENGINE_BIN} model=${MODEL_DIR} voices=${VOICES_DIR}`);
  if (!engineReady()) {
    log("WARNING: engine/model files missing; run services/qwen3-tts/setup-engine.sh");
  } else {
    void ensureBuiltinVoice();
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`received ${signal}, stopping`);
    for (const entry of inflight.values()) {
      try { entry.child?.kill("SIGTERM"); } catch {}
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
