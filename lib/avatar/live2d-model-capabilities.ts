import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import type { Live2DModelBindings } from "./live2d-avatar-provider";

export type Live2DExpressionCapability = {
  name: string;
  file: string;
};

export type Live2DMotionCapability = {
  group: string;
  index: number;
  file: string;
  /** Human-readable label; recovered folder assets use their filename. */
  name?: string;
};

export type Live2DParameterCapability = {
  id: string;
  name?: string;
};

export type Live2DModelCapabilities = {
  expressions: Live2DExpressionCapability[];
  motions: Live2DMotionCapability[];
  parameters: Live2DParameterCapability[];
  suggestedMouthParameter?: string;
  unregisteredExpressionFiles: string[];
  unregisteredMotionFiles: string[];
};

/**
 * Runtime-only group used for motion files found beside a model but omitted
 * from FileReferences.Motions. The user's model3.json is never overwritten.
 */
export const RECOVERED_MOTION_GROUP = "__kana_folder__";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePath(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
}

function resolveReference(settingsPath: string, reference: string): string {
  const base = settingsPath.split("/").slice(0, -1);
  for (const part of reference.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}

function relativeReference(settingsPath: string, targetPath: string): string {
  const from = settingsPath.split("/").slice(0, -1);
  const to = targetPath.split("/");
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }
  return [
    ...Array.from({ length: from.length - common }, () => ".."),
    ...to.slice(common),
  ].join("/");
}

async function readJson(file: File | undefined): Promise<unknown> {
  if (!file) return undefined;
  try {
    return JSON.parse(await file.text());
  } catch {
    return undefined;
  }
}

function appendParameter(
  target: Map<string, Live2DParameterCapability>,
  id: unknown,
  name?: unknown,
): void {
  if (typeof id !== "string" || !id.trim()) return;
  const normalizedId = id.trim();
  const normalizedName = typeof name === "string" && name.trim()
    ? name.trim()
    : undefined;
  const previous = target.get(normalizedId);
  target.set(normalizedId, {
    id: normalizedId,
    ...(normalizedName || previous?.name
      ? { name: normalizedName ?? previous?.name }
      : {}),
  });
}

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function presetName(path: string, suffix: ".exp3.json" | ".motion3.json"): string {
  const filename = path.split("/").at(-1) ?? path;
  const stem = filename.slice(0, -suffix.length);
  const readable = stem
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return readable || (suffix === ".exp3.json" ? "Expression" : "Motion");
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  const result = `${base} ${index}`;
  used.add(result);
  return result;
}

const EMOTION_ALIASES: Record<Emotion, readonly string[]> = {
  neutral: ["neutral", "normal", "default", "calm"],
  happy: ["happy", "smile", "joy", "joyful"],
  sad: ["sad", "sorrow", "cry", "crying"],
  angry: ["angry", "mad", "rage"],
  surprised: ["surprised", "surprise", "shock", "shocked"],
  thinking: ["thinking", "think", "ponder"],
  confused: ["confused", "confusion", "puzzled"],
  excited: ["excited", "excitement", "celebrate"],
};

function matchesEmotion(value: string, emotion: Emotion): boolean {
  const tokens = new Set(normalizedTokens(value));
  return EMOTION_ALIASES[emotion].some((alias) => tokens.has(alias));
}

function suggestedMouthParameter(
  parameters: Live2DParameterCapability[],
  lipSyncIds: string[],
  trackingMouthIds: string[],
): string | undefined {
  const available = new Set(parameters.map(({ id }) => id));
  const tracked = trackingMouthIds.find((id) => available.has(id));
  if (tracked) return tracked;
  const exact = parameters.find(({ id }) => id === "ParamMouthOpenY");
  if (exact) return exact.id;
  const registeredOpen = lipSyncIds.find((id) => {
    const normalized = id.toLowerCase();
    return normalized.includes("open") || normalized.endsWith("a");
  });
  if (registeredOpen) return registeredOpen;
  const likely = parameters.find(({ id, name }) => {
    const candidate = `${id} ${name ?? ""}`.toLowerCase();
    return candidate.includes("mouth") && candidate.includes("open");
  });
  if (likely) return likely.id;
  if (lipSyncIds.length) return lipSyncIds[0];
  // A few otherwise valid models (including Live2D's Mao sample) use ParamA.
  return parameters.some(({ id }) => id === "ParamA") ? "ParamA" : undefined;
}

export async function discoverLive2DModelCapabilities(
  files: File[],
): Promise<Live2DModelCapabilities> {
  const paths = files.map(relativePath);
  const byPath = new Map(paths.map((path, index) => [path, files[index]]));
  const settingsPath = paths.find((path) => path.toLowerCase().endsWith(".model3.json"));
  if (!settingsPath) {
    throw new Error("The Live2D package does not contain a .model3.json file.");
  }
  const settings = await readJson(byPath.get(settingsPath));
  if (!isRecord(settings) || !isRecord(settings.FileReferences)) {
    throw new Error("The Live2D model settings are not readable.");
  }
  const references = settings.FileReferences;
  const expressions: Live2DExpressionCapability[] = [];
  const expressionPaths = new Set<string>();
  if (Array.isArray(references.Expressions)) {
    for (const candidate of references.Expressions) {
      if (
        !isRecord(candidate) ||
        typeof candidate.Name !== "string" ||
        !candidate.Name.trim() ||
        typeof candidate.File !== "string" ||
        !candidate.File.trim()
      ) {
        continue;
      }
      const file = resolveReference(settingsPath, candidate.File.trim());
      expressionPaths.add(file);
      expressions.push({ name: candidate.Name.trim(), file });
    }
  }

  const motions: Live2DMotionCapability[] = [];
  const motionPaths = new Set<string>();
  if (isRecord(references.Motions)) {
    for (const [group, candidates] of Object.entries(references.Motions)) {
      if (!Array.isArray(candidates)) continue;
      candidates.forEach((candidate, index) => {
        if (!isRecord(candidate) || typeof candidate.File !== "string") return;
        const file = resolveReference(settingsPath, candidate.File.trim());
        motionPaths.add(file);
        motions.push({ group, index, file });
      });
    }
  }

  const parameters = new Map<string, Live2DParameterCapability>();
  const lipSyncIds: string[] = [];
  const trackingMouthIds: string[] = [];
  if (Array.isArray(settings.Groups)) {
    for (const group of settings.Groups) {
      if (!isRecord(group) || !Array.isArray(group.Ids)) continue;
      for (const id of group.Ids) {
        appendParameter(parameters, id);
        if (
          group.Target === "Parameter" &&
          typeof group.Name === "string" &&
          group.Name.toLowerCase() === "lipsync" &&
          typeof id === "string"
        ) {
          lipSyncIds.push(id);
        }
      }
    }
  }

  if (typeof references.DisplayInfo === "string") {
    const displayPath = resolveReference(settingsPath, references.DisplayInfo);
    const displayInfo = await readJson(byPath.get(displayPath));
    if (isRecord(displayInfo) && Array.isArray(displayInfo.Parameters)) {
      for (const parameter of displayInfo.Parameters) {
        if (isRecord(parameter)) appendParameter(parameters, parameter.Id, parameter.Name);
      }
    }
  }

  // VTube Studio exports often leave model3.json's LipSync group empty while
  // recording the actual face-tracking mapping in a companion .vtube.json.
  // Treat its MouthOpen -> OutputLive2D mapping as authoritative metadata.
  for (const [path, file] of byPath) {
    if (!path.toLowerCase().endsWith(".vtube.json")) continue;
    const tracking = await readJson(file);
    if (!isRecord(tracking) || !Array.isArray(tracking.ParameterSettings)) continue;
    for (const setting of tracking.ParameterSettings) {
      if (
        !isRecord(setting) ||
        typeof setting.Input !== "string" ||
        setting.Input.toLowerCase() !== "mouthopen" ||
        typeof setting.OutputLive2D !== "string"
      ) {
        continue;
      }
      const id = setting.OutputLive2D.trim();
      if (!id) continue;
      appendParameter(parameters, id, setting.Name);
      trackingMouthIds.push(id);
    }
  }

  for (const file of files) {
    const path = relativePath(file);
    if (!path.toLowerCase().endsWith(".exp3.json")) continue;
    const expression = await readJson(file);
    if (!isRecord(expression) || !Array.isArray(expression.Parameters)) continue;
    for (const parameter of expression.Parameters) {
      if (isRecord(parameter)) appendParameter(parameters, parameter.Id);
    }
  }

  const parameterList = [...parameters.values()];
  const unregisteredExpressionFiles = paths.filter(
    (path) => path.toLowerCase().endsWith(".exp3.json") && !expressionPaths.has(path),
  );
  const unregisteredMotionFiles = paths.filter(
    (path) => path.toLowerCase().endsWith(".motion3.json") && !motionPaths.has(path),
  );

  // Loose presets are common in exported VTuber folders. They are not given
  // a semantic emotion here; Kana only makes them selectable and previewable.
  const usedExpressionNames = new Set(expressions.map(({ name }) => name));
  for (const file of unregisteredExpressionFiles) {
    expressions.push({
      name: uniqueName(presetName(file, ".exp3.json"), usedExpressionNames),
      file,
    });
  }
  const recoveredMotionOffset = motions.filter(
    ({ group }) => group === RECOVERED_MOTION_GROUP,
  ).length;
  unregisteredMotionFiles.forEach((file, index) => {
    motions.push({
      group: RECOVERED_MOTION_GROUP,
      index: recoveredMotionOffset + index,
      file,
      name: presetName(file, ".motion3.json"),
    });
  });

  return {
    expressions,
    motions,
    parameters: parameterList,
    suggestedMouthParameter: suggestedMouthParameter(
      parameterList,
      lipSyncIds,
      trackingMouthIds,
    ),
    unregisteredExpressionFiles,
    unregisteredMotionFiles,
  };
}

/**
 * Add loose expression/motion files to an in-memory copy of model3.json so
 * pixi-live2d-display can load them. This never edits the folder or the copy
 * persisted in IndexedDB; it only repairs the package handed to the runtime.
 */
export async function withRecoveredLive2DPresets(files: File[]): Promise<File[]> {
  const paths = files.map(relativePath);
  const settingsIndex = paths.findIndex((path) => path.toLowerCase().endsWith(".model3.json"));
  if (settingsIndex < 0) return files;

  const capabilities = await discoverLive2DModelCapabilities(files);
  if (
    !capabilities.unregisteredExpressionFiles.length &&
    !capabilities.unregisteredMotionFiles.length
  ) {
    return files;
  }

  const parsed = await readJson(files[settingsIndex]);
  if (!isRecord(parsed) || !isRecord(parsed.FileReferences)) return files;
  const references = parsed.FileReferences;
  const existingExpressions = Array.isArray(references.Expressions)
    ? [...references.Expressions]
    : [];
  for (const capability of capabilities.expressions) {
    if (!capabilities.unregisteredExpressionFiles.includes(capability.file)) continue;
    existingExpressions.push({
      Name: capability.name,
      File: relativeReference(paths[settingsIndex], capability.file),
    });
  }
  if (existingExpressions.length) references.Expressions = existingExpressions;

  const existingMotions = isRecord(references.Motions)
    ? { ...references.Motions }
    : {};
  const recoveredMotions = Array.isArray(existingMotions[RECOVERED_MOTION_GROUP])
    ? [...existingMotions[RECOVERED_MOTION_GROUP] as unknown[]]
    : [];
  for (const file of capabilities.unregisteredMotionFiles) {
    recoveredMotions.push({
      File: relativeReference(paths[settingsIndex], file),
    });
  }
  if (recoveredMotions.length) {
    existingMotions[RECOVERED_MOTION_GROUP] = recoveredMotions;
    references.Motions = existingMotions;
  }

  const original = files[settingsIndex];
  const repaired = new File([JSON.stringify(parsed)], original.name, {
    type: original.type || "application/json",
    lastModified: original.lastModified,
  });
  Object.defineProperty(repaired, "webkitRelativePath", {
    configurable: true,
    value: paths[settingsIndex],
  });
  return files.map((file, index) => index === settingsIndex ? repaired : file);
}

export function suggestLive2DModelBindings(
  capabilities: Live2DModelCapabilities,
): Live2DModelBindings {
  const emotionExpressions: Partial<Record<Emotion, string>> = {};
  const emotionMotions: Partial<
    Record<Emotion, { group: string; index?: number }>
  > = {};
  const usedExpressions = new Set<string>();
  const usedMotions = new Set<string>();

  for (const emotion of EMOTIONS) {
    const expression = capabilities.expressions.find(
      (candidate) =>
        !usedExpressions.has(candidate.name) &&
        matchesEmotion(`${candidate.name} ${candidate.file}`, emotion),
    );
    if (expression) {
      emotionExpressions[emotion] = expression.name;
      usedExpressions.add(expression.name);
    }

    const motion = capabilities.motions.find((candidate) => {
      const key = `${candidate.group}:${candidate.index}`;
      return !usedMotions.has(key) && matchesEmotion(`${candidate.group} ${candidate.file}`, emotion);
    });
    if (motion) {
      emotionMotions[emotion] = { group: motion.group, index: motion.index };
      usedMotions.add(`${motion.group}:${motion.index}`);
    }
  }

  return {
    // Keep the discovered ID as a capability hint, not a persisted choice.
    // Runtime auto-detection can then improve without rewriting preferences.
    mouthOpenParameter: "auto",
    emotionExpressions,
    emotionMotions,
    motions: {},
  };
}
