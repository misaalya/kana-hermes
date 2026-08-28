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
};

export type Live2DParameterCapability = {
  id: string;
  name?: string;
};

export type Live2DModelCapabilities = {
  expressions: Live2DExpressionCapability[];
  motions: Live2DMotionCapability[];
  parameters: Live2DParameterCapability[];
  suggestedMouthParameter: string;
  unregisteredExpressionFiles: string[];
  unregisteredMotionFiles: string[];
};

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
): string {
  if (lipSyncIds.length) return lipSyncIds[0];
  const exact = parameters.find(({ id }) => id === "ParamMouthOpenY");
  if (exact) return exact.id;
  const likely = parameters.find(({ id, name }) => {
    const candidate = `${id} ${name ?? ""}`.toLowerCase();
    return candidate.includes("mouth") && candidate.includes("open");
  });
  return likely?.id ?? "ParamMouthOpenY";
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
  return {
    expressions,
    motions,
    parameters: parameterList,
    suggestedMouthParameter: suggestedMouthParameter(parameterList, lipSyncIds),
    unregisteredExpressionFiles: paths.filter(
      (path) => path.toLowerCase().endsWith(".exp3.json") && !expressionPaths.has(path),
    ),
    unregisteredMotionFiles: paths.filter(
      (path) => path.toLowerCase().endsWith(".motion3.json") && !motionPaths.has(path),
    ),
  };
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
    mouthOpenParameter: capabilities.suggestedMouthParameter,
    emotionExpressions,
    emotionMotions,
    motions: {},
  };
}
