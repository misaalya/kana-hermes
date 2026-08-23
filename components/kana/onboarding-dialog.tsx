"use client";

import { useState } from "react";
import type { KanaPreferences } from "@/lib/preferences/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnPrimary, btnSecondary, bentoCard, chipBase } from "./ui";

type OnboardingDialogProps = {
  preferences: KanaPreferences;
  onTestAgent(preferences: KanaPreferences): Promise<string>;
  onComplete(preferences: KanaPreferences): Promise<void>;
};

const STEPS = ["Welcome", "Agent", "Presentation", "Ready"] as const;

export function OnboardingDialog({
  preferences,
  onTestAgent,
  onComplete,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();

  const finish = async (next: KanaPreferences) => {
    setSaving(true);
    setNotice(null);
    try {
      await onComplete({ ...next, onboardingCompleted: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save setup.");
      setSaving(false);
    }
  };

  const inputClass =
    "min-h-9 w-full rounded-xl border border-line-strong bg-transparent px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

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
        {/* Progress tile */}
        <div className={`mb-2 flex flex-wrap items-center gap-1.5 ${bentoCard}`} aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${
                index === step
                  ? "border-accent bg-accent text-on-accent"
                  : index < step
                    ? "border-line-strong text-muted"
                    : "border-line text-faint"
              }`}
            >
              {index + 1} {label}
            </span>
          ))}
        </div>

        <div className="grid gap-2">
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

          {step === 1 ? (
            <div className={`${bentoCard} flex flex-col gap-3`}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Step 2</p>
              <h1 id="onboarding-title" className="text-lg font-bold text-ink">Choose the agent connection</h1>
              <p className="text-xs leading-relaxed text-ink-dim">
                Kana connects to a separately running, unmodified <code className="font-mono">hermes serve</code>.
                Kana can start it for you from the connection screen after setup.
              </p>
              <div className="flex flex-col gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-muted">WebSocket URL</span>
                  <input
                    className={`${inputClass} font-mono`}
                    value={draft.hermes.websocketUrl}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hermes: {
                          ...draft.hermes,
                          websocketUrl: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-muted">Session token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    value={draft.hermes.token}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hermes: { ...draft.hermes, token: event.target.value },
                      })
                    }
                  />
                  <span className="text-[10px] text-faint">Kept only in this browser tab.</span>
                </label>
              </div>
              <button
                type="button"
                className={`${btnSecondary} self-start`}
                disabled={testing}
                onClick={() => {
                  setTesting(true);
                  setNotice(null);
                  void onTestAgent(draft)
                    .then(setNotice)
                    .catch((error) =>
                      setNotice(
                        error instanceof Error
                          ? error.message
                          : "The agent connection test failed.",
                      ),
                    )
                    .finally(() => setTesting(false));
                }}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className={`${bentoCard} flex flex-col gap-4`}>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Step 3</p>
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

          {step === 3 ? (
            <div className={`${bentoCard}`}>
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Setup summary</p>
              <h1 id="onboarding-title" className="mt-0.5 mb-3 text-lg font-bold text-ink">Kana is ready</h1>
              <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Agent", draft.agentMode],
                  ["Subtitles", draft.subtitleLanguage],
                  ["Voice", draft.voiceMode],
                  ["Avatar", draft.avatarMode],
                ].map(([term, value]) => (
                  <div key={term} className="rounded-xl border border-line bg-surface px-3 py-2">
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
              step === STEPS.length - 1
                ? void finish(draft)
                : (setNotice(null), setStep((current) => current + 1))
            }
          >
            {saving
              ? "Saving…"
              : step === STEPS.length - 1
                ? "Enter Kana"
                : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
