"use client";

import { useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnPrimary, btnSecondary, bentoCard, chipBase } from "./ui";

type OnboardingDialogProps = {
  preferences: KanaPreferences;
  onComplete(preferences: KanaPreferences): Promise<void>;
};

export function OnboardingDialog({
  preferences,
  onComplete,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();

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
          {/* Step 0: Welcome */}
          {step === 0 ? (
            <div className={bentoCard}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Local presentation layer</p>
              <h1 id="onboarding-title" className="mt-0.5 mb-2 text-lg font-bold text-ink">Welcome to Kana</h1>
              <p className="text-xs leading-relaxed text-ink-dim">
                Kana gives your existing Hermes Agent a visual conversation,
                Japanese voice, subtitles, and a replaceable avatar. Hermes
                remains the only agent and keeps ownership of tools, memory,
                sessions, and reasoning.
              </p>
              <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong py-2.5 text-xs font-semibold">
                <span className="text-ink-dim">Kana Web UI</span>
                <b aria-hidden="true" className="text-accent-strong">→</b>
                <span className="text-ink-dim">Your Hermes</span>
              </div>
            </div>
          ) : null}

          {/* Step 1: Presentation */}
          {step === 1 ? (
            <div className={`${bentoCard} flex flex-col gap-4`}>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Presentation</p>
                <h1 id="onboarding-title" className="mt-0.5 text-lg font-bold text-ink">Choose how Kana is presented</h1>
              </div>
              <SubtitleLanguagePicker
                value={draft.subtitleLanguage}
                onChange={(subtitleLanguage) => setDraft({ ...draft, subtitleLanguage })}
              />
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Japanese voice</span>
                  <span className={`${chipBase} border-accent bg-accent text-on-accent`}>Local Qwen3-TTS</span>
                  <span className="text-[10px] text-faint">Runs as a separate local service.</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Avatar</span>
                  <span className={`${chipBase} border-accent bg-accent text-on-accent`}>Official Live2D sample</span>
                  <span className="text-[10px] text-faint">Import another Cubism model later.</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Step 2: Ready */}
          {step === 2 ? (
            <div className={bentoCard}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Setup summary</p>
              <h1 id="onboarding-title" className="mt-0.5 mb-3 text-lg font-bold text-ink">Kana is ready</h1>
              <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Subtitles", draft.subtitleLanguage],
                  ["Voice", draft.voiceMode],
                  ["Avatar", draft.avatarMode],
                ].map(([term, value]) => (
                  <div key={term as string} className="rounded-xl border border-line bg-surface px-3 py-2">
                    <dt className="text-[9px] font-bold tracking-wider text-faint uppercase">{term}</dt>
                    <dd className="truncate text-xs font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs leading-relaxed text-ink-dim">
                You can change every presentation setting later. Kana never
                patches Hermes and does not add another model for translation.
              </p>
            </div>
          ) : null}

          {notice ? (
            <div className={`${bentoCard} border-accent/40`} role="status">
              <p className="text-xs text-ink-dim">{notice}</p>
            </div>
          ) : null}
        </div>

        <div className={`mt-2 flex items-center justify-between ${bentoCard}`}>
          {step > 0 ? (
            <button
              className={btnSecondary}
              type="button"
              disabled={saving}
              onClick={() => {
                setNotice(null);
                setStep((current) => Math.max(0, current - 1));
              }}
            >
              Back
            </button>
          ) : <span />}
          <button
            className={btnPrimary}
            type="button"
            disabled={saving}
            onClick={() =>
              step === 2
                ? void finish()
                : (setNotice(null), setStep((current) => current + 1))
            }
          >
            {saving
              ? "Saving…"
              : step === 2
                ? "Enter Kana"
                : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}