"use client";

import { useState } from "react";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { OFFICIAL_LIVE2D_SAMPLES } from "@/lib/avatar/defaults";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { SubtitleLanguage } from "@/lib/presentation/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnGhost, btnPrimary, btnSecondary, sectionEyebrow, Toggle } from "./ui";

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

function StatusRow({ title, body, healthy }: {
  title: string;
  body: string;
  healthy: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-surface-strong p-4 ${healthy ? "border-accent/35" : "border-danger/40"}`}>
      <div className="min-w-0">
        <p className="text-xs font-bold text-ink">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p>
      </div>
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
  const step = steps[stepIndex];
  const { common, onboarding: text } = getCopy(draft.uiLocale);
  const hermesHealthy = deps.hermes !== "missing";
  const voiceHealthy = !draft.voiceEnabled || deps.voice === "ok" || deps.voice === "loading" || deps.voice === "stopped";

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

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[var(--backdrop)] p-3 backdrop-blur-md sm:p-6">
      <section
        className="relative grid h-[min(600px,94dvh)] w-[min(880px,100%)] grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)] overflow-hidden rounded-2xl border border-line bg-raised max-md:grid-cols-1 max-md:rounded-none"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="relative min-h-[280px] overflow-hidden border-r border-line bg-raised max-md:hidden">
          <span className="absolute bottom-5 left-6 text-3xl font-bold text-ink">Kana</span>
        </div>

        <div className="flex min-h-0 flex-col bg-raised">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              {steps.map((item, index) => (
                <span key={item} className={`h-1.5 transition-all ${index === stepIndex ? "w-7 bg-accent" : index < stepIndex ? "w-3 bg-accent/45" : "w-3 bg-line-strong"}`} />
              ))}
            </div>
            <span className="text-[10px] font-semibold text-faint">
              {mode === "repair" ? text.checkup : `${stepIndex + 1} / ${steps.length}`}
            </span>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {step === 0 ? (
              <div>
                <p className={sectionEyebrow}>{text.welcomeEyebrow}</p>
                <h1 id="onboarding-title" className="mt-2 text-2xl font-bold tracking-tight text-ink">{text.welcomeTitle}</h1>
                <p className="mt-3 text-xs leading-6 text-muted">
                  {text.welcomeBody}
                </p>
                <div className="mt-6 rounded-2xl border border-accent/15 bg-accent/8 p-4">
                    <p className="text-[11px] font-bold text-ink">Hermes → Kana → {text.welcomeDiagramYou}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{text.welcomeDiagramBody}</p>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div>
                <p className={sectionEyebrow}>{text.languageEyebrow}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{text.languageTitle}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{text.languageBody}</p>
                <div className="mt-6 space-y-5">
                  <div>
                    <p className="mb-2 text-[10px] font-bold tracking-wide text-muted uppercase">{text.interfaceLabel}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([['id', 'Bahasa Indonesia'], ['en', 'English']] as const).map(([value, label]) => (
                        <button key={value} type="button" className={`kana-focus rounded-xl border px-3 py-3 text-left text-xs font-bold ${draft.uiLocale === value ? "border-accent/45 bg-accent/12 text-accent-strong" : "border-line bg-surface-strong text-ink-dim"}`} onClick={() => setDraft((current) => ({ ...current, uiLocale: value }))}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-bold tracking-wide text-muted uppercase">{text.subtitleLabel}</p>
                    <SubtitleLanguagePicker locale={draft.uiLocale} value={draft.subtitleLanguage} onChange={(subtitleLanguage: SubtitleLanguage) => setDraft((current) => ({ ...current, subtitleLanguage }))} />
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <p className={sectionEyebrow}>{text.characterEyebrow}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{text.characterTitle}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{text.characterBody}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                    const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                    return (
                      <button type="button" key={sample.id} onClick={() => selectAvatar(index)} className={`kana-focus flex items-center gap-3 rounded-xl border p-3 text-left ${active ? "border-accent/45 bg-accent/12" : "border-line bg-surface-strong"}`}>
                        <span>
                          <span className="block text-xs font-bold text-ink">{sample.name}</span>
                          <span className="mt-0.5 block text-[9px] text-muted">{active ? common.selected : "Live2D"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-strong p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div>
                      <p className="text-xs font-bold text-ink">{text.voiceLabel}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{draft.voiceEnabled ? common.on : common.off}</p>
                    </div>
                  </div>
                  <Toggle checked={draft.voiceEnabled} label={text.voiceLabel} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div>
                <p className={sectionEyebrow}>{mode === "repair" ? text.checkup : text.almostThere}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{mode === "repair" ? text.needsHelpTitle : text.readyTitle}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{text.servicesBody}</p>
                <div className="mt-5 space-y-2">
                  <StatusRow title="Hermes" healthy={hermesHealthy} body={deps.hermes === "running" ? text.hermesRunning : deps.hermes === "installed" ? text.hermesInstalled : text.hermesMissing} />
                  <StatusRow title={text.voiceEngine} healthy={voiceHealthy} body={!draft.voiceEnabled ? text.voiceNotNeeded : deps.voice === "ok" ? text.voiceReady : deps.voice === "error" ? text.voiceNeedsAttention : text.voicePreparedOnUse} />
                </div>
                {!hermesHealthy || !voiceHealthy ? <button type="button" className={`${btnSecondary} mt-4`} onClick={onOpenSettings}>{text.openConnectionSettings}</button> : null}
              </div>
            ) : null}

            {notice ? <p className="mt-4 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] text-danger" role="status">{notice}</p> : null}
          </main>

          <footer className="flex items-center justify-between border-t border-line px-5 py-4">
            {stepIndex > 0 ? (
              <button type="button" className={btnGhost} disabled={saving} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>{common.back}</button>
            ) : mode === "repair" ? (
              <button type="button" className={btnGhost} onClick={onDismiss}>{common.later}</button>
            ) : <span />}
            <button type="button" className={btnPrimary} disabled={saving} onClick={goNext}>
              {saving ? common.saving : stepIndex === steps.length - 1 ? (mode === "repair" ? common.done : common.start) : common.continueLabel}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
