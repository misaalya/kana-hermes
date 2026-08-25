"use client";

import { useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { UiLocale } from "@/lib/ui/copy";
import { getCopy } from "@/lib/ui/copy";
import type { SubtitleLanguage } from "@/lib/presentation/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnPrimary, btnSecondary, bentoCard, chipBase } from "./ui";

export type DependencyFindings = {
  /** Hermes agent brain availability. */
  hermes: "running" | "installed" | "missing";
  /** Qwen3-TTS engine health; null when the user keeps voice off. */
  voice: "ok" | "loading" | "stopped" | "error" | "off" | null;
};

type OnboardingDialogProps = {
  locale: UiLocale;
  preferences: KanaPreferences;
  deps: DependencyFindings;
  /** full = first-run wizard; repair = a dependency is unhealthy. */
  mode: "full" | "repair";
  onComplete(preferences: KanaPreferences): Promise<void>;
  onDismiss(): void;
  onOpenSettings(): void;
};

export function OnboardingWizard({
  locale,
  preferences,
  deps,
  mode,
  onComplete,
  onDismiss,
  onOpenSettings,
}: OnboardingDialogProps) {
  const copy = getCopy(locale);
  const steps = mode === "full" ? ([0, 1, 2, 3] as const) : ([2, 3] as const);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();

  const voiceLine =
    deps.voice === "off"
      ? copy.deps.voiceOff
      : deps.voice === "ok"
        ? copy.deps.voiceOk
        : deps.voice === "loading"
          ? copy.deps.voiceLoading
          : deps.voice === "error"
            ? copy.deps.voiceError
            : deps.voice === "stopped"
              ? copy.deps.voiceStopped
              : copy.deps.voiceNotProbed;
  const hermesLine =
    deps.hermes === "running"
      ? copy.deps.hermesRunning
      : deps.hermes === "installed"
        ? copy.deps.hermesInstalled
        : copy.deps.hermesMissing;

  const finish = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await onComplete({ ...draft, onboardingCompleted: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save setup.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg p-3">
      <section
        className="max-h-[92dvh] w-[min(640px,100%)] overflow-y-auto rounded-3xl border border-line bg-bg p-3"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="grid gap-2">
          {/* Step: Welcome (full mode only) */}
          {step === 0 ? (
            <div className={bentoCard}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">{copy.welcome.eyebrow}</p>
              <h1 id="onboarding-title" className="mt-0.5 mb-2 text-lg font-bold text-ink">{copy.welcome.title}</h1>
              <p className="text-xs leading-relaxed text-ink-dim">{copy.welcome.body}</p>
              <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong py-2.5 text-xs font-semibold">
                <span className="text-ink-dim">{copy.welcome.diagramFrom}</span>
                <b aria-hidden="true" className="text-accent-strong">→</b>
                <span className="text-ink-dim">{copy.welcome.diagramTo}</span>
              </div>
            </div>
          ) : null}

          {/* Step: Presentation */}
          {step === 1 ? (
            <div className={`${bentoCard} flex flex-col gap-4`}>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-muted uppercase">{copy.presentation.eyebrow}</p>
                <h1 id="onboarding-title" className="mt-0.5 text-lg font-bold text-ink">{copy.presentation.title}</h1>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted">{copy.presentation.uiLanguageLabel}</span>
                <select
                  className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink"
                  value={draft.uiLocale}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, uiLocale: event.target.value as UiLocale }))
                  }
                >
                  {Object.entries(copy.localeNames).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted">{copy.presentation.subtitleLabel}</span>
                <SubtitleLanguagePicker
                  value={draft.subtitleLanguage}
                  onChange={(subtitleLanguage: SubtitleLanguage) =>
                    setDraft((prev) => ({ ...prev, subtitleLanguage }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">{copy.presentation.voiceTitle}</span>
                  <span className={`${chipBase} border-accent bg-accent text-on-accent`}>{copy.presentation.voiceValue}</span>
                  <span className="text-[10px] text-faint">{copy.presentation.voiceHint}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">{copy.presentation.avatarTitle}</span>
                  <span className={`${chipBase} border-accent bg-accent text-on-accent`}>{copy.presentation.avatarValue}</span>
                  <span className="text-[10px] text-faint">{copy.presentation.avatarHint}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Step: Dependency check (also the repair landing step) */}
          {step === 2 ? (
            <div className={`${bentoCard} flex flex-col gap-3`}>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-muted uppercase">
                  {mode === "repair" ? copy.repair.eyebrow : copy.deps.eyebrow}
                </p>
                <h1 id="onboarding-title" className="mt-0.5 text-lg font-bold text-ink">
                  {mode === "repair" ? copy.repair.title : copy.deps.title}
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                  {mode === "repair" ? copy.repair.intro : copy.deps.body}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                <p className="text-[11px] font-bold text-ink">{copy.deps.hermesTitle}</p>
                <p className={`text-[11px] ${deps.hermes === "missing" ? "font-semibold text-danger" : "text-ink-dim"}`}>
                  {hermesLine}
                </p>
                <p className="text-[11px] font-bold text-ink">{copy.deps.voiceTitle}</p>
                <p className={`text-[11px] ${deps.voice === "error" ? "font-semibold text-danger" : "text-ink-dim"}`}>
                  {voiceLine}
                </p>
              </div>
              {mode === "repair" ? (
                <button type="button" className={btnSecondary} onClick={onOpenSettings}>
                  {copy.repair.openSettings}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Step: Ready */}
          {step === 3 ? (
            <div className={bentoCard}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">{copy.ready.eyebrow}</p>
              <h1 id="onboarding-title" className="mt-0.5 mb-3 text-lg font-bold text-ink">{copy.ready.title}</h1>
              <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [copy.ready.subtitlesLabel, draft.subtitleLanguage],
                  [copy.ready.voiceLabel, copy.voiceOnOff(draft.voiceEnabled)],
                  [copy.presentation.uiLanguageLabel, copy.localeNames[draft.uiLocale]],
                  [copy.ready.avatarLabel, copy.presentation.avatarValue],
                ].map(([term, value]) => (
                  <div key={term as string} className="rounded-xl border border-line bg-surface px-3 py-2">
                    <dt className="text-[9px] font-bold tracking-wider text-faint uppercase">{term}</dt>
                    <dd className="truncate text-xs font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs leading-relaxed text-ink-dim">{copy.ready.body}</p>
            </div>
          ) : null}

          {notice ? (
            <div className={`${bentoCard} border-accent/40`} role="status">
              <p className="text-xs text-ink-dim">{notice}</p>
            </div>
          ) : null}
        </div>

        <div className={`mt-2 flex items-center justify-between ${bentoCard}`}>
          {stepIndex > 0 ? (
            <button
              className={btnSecondary}
              type="button"
              disabled={saving}
              onClick={() => {
                setNotice(null);
                setStepIndex((current) => Math.max(0, current - 1));
              }}
            >
              {copy.common.back}
            </button>
          ) : mode === "repair" ? (
            <button type="button" className={btnSecondary} onClick={onDismiss}>
              {copy.repair.dismiss}
            </button>
          ) : (
            <span />
          )}
          <button
            className={btnPrimary}
            type="button"
            disabled={saving}
            onClick={() => {
              if (stepIndex === steps.length - 1) {
                if (mode === "full") void finish();
                else onDismiss();
                return;
              }
              setNotice(null);
              setStepIndex((current) => current + 1);
            }}
          >
            {saving
              ? copy.common.saving
              : stepIndex === steps.length - 1
                ? mode === "full"
                  ? copy.common.done
                  : copy.repair.dismiss
                : copy.common.continueLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
