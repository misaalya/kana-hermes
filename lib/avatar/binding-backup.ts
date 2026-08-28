import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import type { Live2DModelBindings } from "./live2d-avatar-provider";

export type Live2DBindingBackup = {
  kind: "kana.live2d-bindings";
  version: 1;
  sourceLabel: string;
  bindings: Live2DModelBindings;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLive2DBindingBackup(
  sourceLabel: string,
  bindings: Live2DModelBindings,
): Live2DBindingBackup {
  return {
    kind: "kana.live2d-bindings",
    version: 1,
    sourceLabel: sourceLabel.slice(0, 500),
    bindings,
  };
}

export function parseLive2DBindingBackup(text: string): Live2DBindingBackup {
  if (text.length > 1024 * 1024) {
    throw new Error("Live2D binding files must be smaller than 1 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The Live2D binding file is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.kind !== "kana.live2d-bindings" ||
    value.version !== 1 ||
    !isRecord(value.bindings)
  ) {
    throw new Error("This is not a supported Kana Live2D binding file.");
  }
  const mouth = value.bindings.mouthOpenParameter;
  if (typeof mouth !== "string" || !mouth.trim() || mouth.length > 500) {
    throw new Error("The Live2D mouth parameter is invalid.");
  }
  const emotionExpressions: Partial<Record<Emotion, string>> = {};
  if (isRecord(value.bindings.emotionExpressions)) {
    for (const emotion of EMOTIONS) {
      const expression = value.bindings.emotionExpressions[emotion];
      if (typeof expression === "string" && expression.length <= 500) {
        emotionExpressions[emotion] = expression;
      }
    }
  }
  const emotionMotions: Live2DModelBindings["emotionMotions"] = {};
  if (isRecord(value.bindings.emotionMotions)) {
    for (const emotion of EMOTIONS) {
      const candidate = value.bindings.emotionMotions[emotion];
      if (
        !isRecord(candidate) ||
        typeof candidate.group !== "string" ||
        !candidate.group.trim() ||
        candidate.group.length > 500
      ) {
        continue;
      }
      const index = candidate.index;
      if (
        index !== undefined &&
        (typeof index !== "number" || !Number.isInteger(index) || index < 0)
      ) {
        continue;
      }
      emotionMotions[emotion] = {
        group: candidate.group,
        ...(index === undefined ? {} : { index }),
      };
    }
  }
  const motions: Live2DModelBindings["motions"] = {};
  if (isRecord(value.bindings.motions)) {
    for (const [name, candidate] of Object.entries(value.bindings.motions)) {
      if (
        name.length > 500 ||
        !isRecord(candidate) ||
        typeof candidate.group !== "string" ||
        !candidate.group.trim() ||
        candidate.group.length > 500
      ) {
        continue;
      }
      const index = candidate.index;
      if (
        index !== undefined &&
        (typeof index !== "number" || !Number.isInteger(index) || index < 0)
      ) {
        continue;
      }
      motions[name] = {
        group: candidate.group,
        ...(index === undefined ? {} : { index }),
      };
    }
  }
  return {
    kind: "kana.live2d-bindings",
    version: 1,
    sourceLabel:
      typeof value.sourceLabel === "string" ? value.sourceLabel.slice(0, 500) : "",
    bindings: {
      mouthOpenParameter: mouth,
      emotionExpressions,
      emotionMotions,
      motions,
    },
  };
}
