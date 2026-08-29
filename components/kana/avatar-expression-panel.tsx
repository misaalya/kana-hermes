"use client";

import { useMemo, useState } from "react";
import type { Live2DModelBindings } from "@/lib/avatar/live2d-avatar-provider";
import type {
  Live2DModelCapabilities,
  Live2DMotionCapability,
} from "@/lib/avatar/live2d-model-capabilities";
import { EMOTIONS, type Emotion } from "@/lib/presentation/types";
import type { Copy } from "@/lib/ui/copy";
import { btnGhost, inputBase } from "./ui";

function motionValue(motion: Live2DMotionCapability): string {
  return JSON.stringify([motion.group, motion.index]);
}

function selectedMotionValue(
  motion: { group: string; index?: number } | undefined,
): string {
  return motion ? JSON.stringify([motion.group, motion.index ?? 0]) : "";
}

export function AvatarExpressionPanel({
  bindings,
  capabilities,
  copy,
  onChange,
  onPreview,
  onPreviewTalking,
}: {
  bindings: Live2DModelBindings;
  capabilities: Live2DModelCapabilities;
  copy: Copy["settings"];
  onChange(bindings: Live2DModelBindings): void;
  onPreview(emotion: Emotion): Promise<void>;
  onPreviewTalking(): Promise<void>;
}) {
  const [previewing, setPreviewing] = useState<Emotion | null>(null);
  const mappedCount = useMemo(
    () => EMOTIONS.filter(
      (emotion) =>
        Boolean(bindings.emotionExpressions?.[emotion]) ||
        Boolean(bindings.emotionMotions?.[emotion]),
    ).length,
    [bindings.emotionExpressions, bindings.emotionMotions],
  );
  const manualMouthParameter = bindings.mouthOpenParameter !== "auto";
  const mouthOptions = useMemo(() => {
    const options = [...capabilities.parameters];
    if (
      manualMouthParameter &&
      !options.some(({ id }) => id === bindings.mouthOpenParameter)
    ) {
      options.unshift({ id: bindings.mouthOpenParameter });
    }
    return options;
  }, [bindings.mouthOpenParameter, capabilities.parameters, manualMouthParameter]);
  const hasPresets = capabilities.expressions.length > 0 || capabilities.motions.length > 0;
  const unregisteredCount =
    capabilities.unregisteredExpressionFiles.length +
    capabilities.unregisteredMotionFiles.length;

  const updateExpression = (emotion: Emotion, expression: string) => {
    const emotionExpressions = { ...bindings.emotionExpressions };
    if (expression) emotionExpressions[emotion] = expression;
    else delete emotionExpressions[emotion];
    onChange({ ...bindings, emotionExpressions });
  };

  const updateMotion = (emotion: Emotion, value: string) => {
    const emotionMotions = { ...bindings.emotionMotions };
    if (!value) {
      delete emotionMotions[emotion];
    } else {
      const [group, index] = JSON.parse(value) as [string, number];
      emotionMotions[emotion] = { group, index };
    }
    onChange({ ...bindings, emotionMotions });
  };

  const preview = async (emotion: Emotion) => {
    setPreviewing(emotion);
    try {
      await onPreview(emotion);
    } finally {
      setPreviewing(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-line bg-surface">
      <header className="flex flex-col gap-3 border-b-2 border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <h3 className="text-sm font-bold text-ink">{copy.avatarBehaviorTitle}</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted">
            {copy.avatarBehaviorDescription}
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-[9px] font-bold text-white">
          {copy.avatarBehaviorReady(mappedCount, EMOTIONS.length)}
        </span>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 rounded-xl bg-surface-strong px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
          <span className="text-xs font-bold text-ink">{copy.avatarMouthParameter}</span>
          <span className="mt-0.5 block text-[9px] leading-relaxed text-muted">
            {copy.avatarMouthHint}
          </span>
          </div>
          <span className={`shrink-0 text-[9px] font-bold ${manualMouthParameter ? "text-ink" : "text-accent"}`}>
            {manualMouthParameter
              ? copy.avatarMouthManual
              : copy.avatarMouthReady}
          </span>
          <details className="basis-full sm:basis-auto">
            <summary className="kana-details-summary kana-focus cursor-pointer text-[9px] font-semibold text-muted">
              {copy.avatarMouthAdvanced}
            </summary>
            <div className="mt-3 flex flex-col gap-2 sm:min-w-80">
              <select
                className={`${inputBase} w-full`}
                value={bindings.mouthOpenParameter}
                aria-label={copy.avatarMouthParameter}
                onChange={(event) => onChange({
                  ...bindings,
                  mouthOpenParameter: event.target.value,
                })}
              >
                <option value="auto">{copy.avatarMouthAutomaticOption}</option>
                {mouthOptions.map((parameter) => (
                  <option key={parameter.id} value={parameter.id}>
                    {parameter.name ? `${parameter.name} · ${parameter.id}` : parameter.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={btnGhost}
                onClick={() => void onPreviewTalking()}
              >
                {copy.avatarMouthPreview}
              </button>
              {manualMouthParameter ? (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => onChange({
                    ...bindings,
                    mouthOpenParameter: "auto",
                  })}
                >
                  {copy.avatarMouthReset}
                </button>
              ) : null}
            </div>
          </details>
        </div>

        {!hasPresets ? (
          <p className="rounded-xl bg-surface-strong px-4 py-3 text-[10px] leading-relaxed text-muted">
            {copy.avatarNoCapabilities}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {EMOTIONS.map((emotion) => {
              const expression = bindings.emotionExpressions?.[emotion] ?? "";
              const motion = bindings.emotionMotions?.[emotion];
              const mapped = Boolean(expression || motion);
              return (
                <article
                  key={emotion}
                  className="rounded-xl border-2 border-line bg-surface-strong p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-xs font-bold text-ink">
                      {copy.avatarEmotionNames[emotion]}
                    </h4>
                    <span className={`text-[9px] font-bold ${mapped ? "text-accent" : "text-faint"}`}>
                      {mapped ? copy.avatarMapped : copy.avatarNotMapped}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-semibold text-muted">
                        {copy.avatarEmotionExpression}
                      </span>
                      <select
                        className={`${inputBase} w-full`}
                        value={expression}
                        onChange={(event) => updateExpression(emotion, event.target.value)}
                      >
                        <option value="">{copy.avatarNoExpression}</option>
                        {capabilities.expressions.map((candidate) => (
                          <option key={candidate.name} value={candidate.name}>
                            {candidate.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-semibold text-muted">
                        {copy.avatarEmotionMotion}
                      </span>
                      <select
                        className={`${inputBase} w-full`}
                        value={selectedMotionValue(motion)}
                        onChange={(event) => updateMotion(emotion, event.target.value)}
                      >
                        <option value="">{copy.avatarNoMotion}</option>
                        {capabilities.motions.map((candidate) => (
                          <option key={motionValue(candidate)} value={motionValue(candidate)}>
                            {candidate.name ?? `${candidate.group} · ${candidate.index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={`${btnGhost} mt-2`}
                    disabled={!mapped || previewing !== null}
                    aria-label={copy.avatarPreviewAria(copy.avatarEmotionNames[emotion])}
                    onClick={() => void preview(emotion)}
                  >
                    {copy.avatarPreview}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {unregisteredCount ? (
          <p className="rounded-xl border-2 border-line bg-raised px-4 py-3 text-[10px] leading-relaxed text-muted">
            {copy.avatarUnregistered(
              capabilities.unregisteredExpressionFiles.length,
              capabilities.unregisteredMotionFiles.length,
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
