"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { OFFICIAL_LIVE2D_SAMPLES } from "@/lib/avatar/defaults";
import type { KanaPreferences } from "@/lib/preferences/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { CheckIcon, LanguageIcon, PersonIcon, PlugIcon } from "./icons";
import { SettingsRow, SettingsRows, SettingsSegmented, StatusPill, settingsButton } from "./settings-layout";
import { btnGhost, btnPrimary, Toggle } from "./ui";

export type DependencyFindings = {
  hermes: "running" | "installed" | "missing";
  voice: "ok" | "loading" | "stopped" | "error" | "off" | null;
};

type OnboardingDialogProps = {
  locale: UiLocale;
  preferences: KanaPreferences;
  deps: DependencyFindings;
  mode: "full" | "repair";
  onComplete(preferences: KanaPreferences): Promise<void>;
  onDismiss(): void;
  onOpenSettings(): void;
};

const PLAN_ICONS = [LanguageIcon, PersonIcon, PlugIcon] as const;

function StepHeading({ kicker, title, body, headingRef }: {
  kicker: string;
  title: string;
  body: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{kicker}</p>
      <h1
        id="onboarding-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1.5 text-[22px] leading-tight font-bold tracking-tight text-ink outline-none"
      >
        {title}
      </h1>
      <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export function OnboardingWizard({
  preferences,
  deps,
  mode,
  onComplete,
  onDismiss,
  onOpenSettings,
}: OnboardingDialogProps) {
  const steps = mode === "full" ? ([0, 1, 2, 3] as const) : ([3] as const);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const step = steps[stepIndex];
  const { common, onboarding: text } = getCopy(draft.uiLocale);
  const hermesHealthy = deps.hermes !== "missing";
  const voiceHealthy = !draft.voiceEnabled || deps.voice === "ok" || deps.voice === "loading" || deps.voice === "stopped";

  // Move focus to each step's title so screen readers announce the new step
  // instead of leaving focus on a button whose label may not have changed.
  // Scheduled after useDialogFocus's own initial focus frame.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stepIndex]);

  const finish = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await onComplete({ ...draft, onboardingCompleted: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text.saveFailed);
      setSaving(false);
    }
  };

  const selectAvatar = (index: number) => {
    const sample = OFFICIAL_LIVE2D_SAMPLES[index];
    if (!sample) return;
    setDraft((current) => ({
      ...current,
      live2d: {
        ...current.live2d,
        modelUrl: sample.modelUrl,
        modelId: undefined,
        modelName: sample.name,
      },
    }));
  };

  const goNext = () => {
    if (stepIndex === steps.length - 1) {
      if (mode === "full") void finish();
      else onDismiss();
      return;
    }
    setNotice(null);
    setStepIndex((current) => current + 1);
  };

  const kicker = (label: string) =>
    mode === "repair" ? label : `${text.stepOf(stepIndex + 1, steps.length)} · ${label}`;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[var(--backdrop)] p-6 backdrop-blur-md max-sm:p-0">
      <section
        className="kana-settings-shell relative flex h-[min(580px,92dvh)] w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl border border-line bg-raised max-sm:h-dvh max-sm:rounded-none max-sm:border-0"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        {mode === "full" ? (
          <div
            className="flex gap-1 px-8 pt-7 max-sm:px-5 max-sm:pt-5"
            role="progressbar"
            aria-label={text.stepOf(stepIndex + 1, steps.length)}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={stepIndex + 1}
          >
            {steps.map((item, index) => (
              <span
                key={item}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${index <= stepIndex ? "bg-accent" : "bg-line-strong/70"}`}
              />
            ))}
          </div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-7 pb-4 max-sm:px-5 max-sm:pt-6">
          {step === 0 ? (
            <div>
              <StepHeading headingRef={headingRef} kicker={kicker(text.welcomeEyebrow)} title={text.welcomeTitle} body={text.welcomeBody} />
              <ol className="mt-6 divide-y divide-line">
                {text.welcomePlan.map((item, index) => {
                  const Icon = PLAN_ICONS[index] ?? PlugIcon;
                  return (
                    <li key={item.title} className="flex items-center gap-3.5 py-3.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-strong text-ink-dim" aria-hidden="true">
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{item.body}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-[11.5px] text-faint">{text.welcomeLater}</p>
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <StepHeading headingRef={headingRef} kicker={kicker(text.languageEyebrow)} title={text.languageTitle} body={text.languageBody} />
              <div className="mt-4">
                <SettingsRows>
                  <SettingsRow label={text.interfaceLabel}>
                    <SettingsSegmented
                      label={text.interfaceLabel}
                      value={draft.uiLocale}
                      options={[{ value: "id", label: "Bahasa Indonesia" }, { value: "en", label: "English" }]}
                      onChange={(uiLocale) => setDraft((current) => ({ ...current, uiLocale }))}
                    />
                  </SettingsRow>
                  <SettingsRow label="Subtitle" description={text.subtitleNote} />
                </SettingsRows>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <StepHeading headingRef={headingRef} kicker={kicker(text.characterEyebrow)} title={text.characterTitle} body={text.characterBody} />
              <div className="mt-5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Live2D">
                {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                  const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      key={sample.id}
                      onClick={() => selectAvatar(index)}
                      className={`kana-focus flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${active ? "border-accent bg-accent/8" : "border-line-strong hover:bg-surface-strong/60"}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-ink">{sample.name}</span>
                        <span className="mt-0.5 block text-[11.5px] text-muted">{text.officialSample}</span>
                      </span>
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full border ${active ? "border-accent bg-accent text-on-accent" : "border-line-strong"}`}
                        aria-hidden="true"
                      >
                        {active ? <CheckIcon className="size-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 border-t border-line">
                <SettingsRow label={text.voiceLabel} description={draft.voiceEnabled ? common.on : common.off}>
                  <Toggle checked={draft.voiceEnabled} label={text.voiceLabel} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                </SettingsRow>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <StepHeading
                headingRef={headingRef}
                kicker={kicker(mode === "repair" ? text.checkup : text.almostThere)}
                title={mode === "repair" ? text.needsHelpTitle : text.readyTitle}
                body={text.servicesBody}
              />
              <div className="mt-4">
                <SettingsRows>
                  <SettingsRow
                    label="Hermes"
                    description={deps.hermes === "running" ? text.hermesRunning : deps.hermes === "installed" ? text.hermesInstalled : text.hermesMissing}
                  >
                    <StatusPill capitalize={false} tone={hermesHealthy ? "ok" : "error"}>{hermesHealthy ? text.statusReady : text.statusAttention}</StatusPill>
                  </SettingsRow>
                  <SettingsRow
                    label={text.voiceEngine}
                    description={!draft.voiceEnabled ? text.voiceNotNeeded : deps.voice === "ok" ? text.voiceReady : deps.voice === "error" ? text.voiceNeedsAttention : text.voicePreparedOnUse}
                  >
                    <StatusPill capitalize={false} tone={!voiceHealthy ? "error" : !draft.voiceEnabled ? "idle" : deps.voice === "ok" ? "ok" : "idle"}>
                      {!voiceHealthy ? text.statusAttention : !draft.voiceEnabled ? common.off : deps.voice === "ok" ? text.statusReady : text.statusOnDemand}
                    </StatusPill>
                  </SettingsRow>
                </SettingsRows>
              </div>
              {!hermesHealthy || !voiceHealthy ? (
                <button type="button" className={`${settingsButton} mt-3`} onClick={onOpenSettings}>{text.openConnectionSettings}</button>
              ) : null}
            </div>
          ) : null}

          {notice ? <p className="mt-4 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger" role="status">{notice}</p> : null}
        </main>

        <footer className="flex items-center justify-between gap-3 px-8 pt-3 pb-7 max-sm:px-5 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">
          {stepIndex > 0 ? (
            <button type="button" className={btnGhost} disabled={saving} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>{common.back}</button>
          ) : mode === "repair" ? (
            <button type="button" className={btnGhost} onClick={onDismiss}>{common.later}</button>
          ) : null}
          <button type="button" className={`${btnPrimary} ml-auto min-w-28 max-sm:flex-1`} disabled={saving} onClick={goNext}>
            {saving ? common.saving : stepIndex === steps.length - 1 ? (mode === "repair" ? common.done : common.start) : common.continueLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
