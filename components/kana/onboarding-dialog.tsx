"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { OFFICIAL_LIVE2D_SAMPLES } from "@/lib/avatar/defaults";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { DependencyFindings } from "@/lib/store/workspace-store";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { CheckIcon, ChevronRightIcon } from "./icons";
import { SettingsRow, SettingsRows, SettingsSegmented, StatusPill, settingsButton } from "./settings-layout";
import { btnGhost, btnPrimary, Toggle } from "./ui";

export type { DependencyFindings };

type OnboardingDialogProps = {
  locale: UiLocale;
  preferences: KanaPreferences;
  deps: DependencyFindings;
  mode: "full" | "repair";
  onComplete(preferences: KanaPreferences): Promise<void>;
  onDismiss(): void;
  onOpenSettings(): void;
  /** The greeting is on screen (true) or gone (false); the stage clears for it. */
  onGreetingChange?(active: boolean): void;
  /** Kana reacts as she starts to speak (an expression on the avatar). */
  onGreet?(): void;
};

/**
 * When each character of a line appears, in ms from the start: a steady pace
 * with a beat after each clause, as a character would speak it.
 */
function typingSchedule(line: string): number[] {
  let at = 0;
  return Array.from(line, (_, index) => {
    const previous = line[index - 1];
    at += previous && ".!?".includes(previous) ? 260 : previous === "," ? 120 : 20;
    return at;
  });
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * First-run hello: no modal and no blur. Kana stays in view and speaks
 * through a game-style dialogue box; clicking the box finishes her line.
 */
function Greeting({ name, line, start, instant, dialogRef, startRef, onKeyDown, onStart }: {
  name: string;
  line: string;
  start: string;
  instant: boolean;
  dialogRef: React.RefObject<HTMLElement | null>;
  startRef: React.RefObject<HTMLButtonElement | null>;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onStart(): void;
}) {
  const [animate] = useState(() => !instant && !prefersReducedMotion());
  const [shown, setShown] = useState(animate ? 0 : line.length);

  // Paced by elapsed time, not by timer ticks, so a busy frame (the avatar
  // renders on the same thread) never slows the line down.
  useEffect(() => {
    if (!animate) return;
    const schedule = typingSchedule(line);
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      let count = 0;
      while (count < schedule.length && schedule[count] <= now - began) count += 1;
      setShown((current) => Math.max(current, count));
      if (count < schedule.length) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, line]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center px-4 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-8 sm:pb-8">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kana-greeting-name"
        aria-describedby="kana-greeting-line"
        onKeyDown={onKeyDown}
        onClick={() => setShown(line.length)}
        className="kana-greeting relative w-full max-w-[640px]"
      >
        <p id="kana-greeting-name" className="kana-greeting-name">{name}</p>
        <p id="kana-greeting-line" className="sr-only">{line}</p>
        {/* The full line reserves the box's height so it never grows while typing. */}
        <p className="kana-greeting-text grid" aria-hidden="true">
          <span className="invisible col-start-1 row-start-1">{line}</span>
          <span className="col-start-1 row-start-1">{line.slice(0, shown)}</span>
        </p>
        <div className="mt-4 flex justify-end">
          <button
            ref={startRef}
            type="button"
            className={`${btnPrimary} min-w-36`}
            onClick={(event) => {
              event.stopPropagation();
              onStart();
            }}
          >
            {start}
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

function StepHeading({ kicker, title, body, headingRef }: {
  kicker: string;
  title: string;
  body: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-muted">{kicker}</p>
      <h1
        id="onboarding-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1.5 text-2xl leading-tight font-extrabold text-ink outline-none"
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
  onGreetingChange,
  onGreet,
}: OnboardingDialogProps) {
  const steps = mode === "full" ? ([0, 1, 2, 3] as const) : ([3] as const);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  // Coming back from the next step shows Kana's line at once.
  const [greeted, setGreeted] = useState(false);
  const step = steps[stepIndex];
  const greeting = step === 0;
  const { common, onboarding: text } = getCopy(draft.uiLocale);
  const hermesHealthy = deps.hermes !== "missing";
  const voiceHealthy = !draft.voiceEnabled || deps.voice === "ok" || deps.voice === "loading" || deps.voice === "stopped" || deps.voice === null;

  // Move focus to each step's title so screen readers announce the new step
  // instead of leaving focus on a button whose label may not have changed.
  // Scheduled after useDialogFocus's own initial focus frame.
  // The greeting focuses its start button instead, announced with Kana's line.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => (greeting ? startRef : headingRef).current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [greeting, stepIndex]);

  useEffect(() => {
    onGreetingChange?.(greeting);
  }, [greeting, onGreetingChange]);
  useEffect(() => () => onGreetingChange?.(false), [onGreetingChange]);

  useEffect(() => {
    if (greeting && !greeted) onGreet?.();
  }, [greeted, greeting, onGreet]);

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
    if (greeting) setGreeted(true);
    setStepIndex((current) => current + 1);
  };

  // The greeting is not a numbered step: count only the setup screens.
  const kicker = (label: string) =>
    mode === "repair" ? label : `${text.stepOf(stepIndex, steps.length - 1)} · ${label}`;

  if (greeting) {
    return (
      <Greeting
        name={text.greetingName}
        line={text.greetingText}
        start={text.greetingStart}
        instant={greeted}
        dialogRef={dialogRef}
        startRef={startRef}
        onKeyDown={onDialogKeyDown}
        onStart={goNext}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[var(--backdrop)] p-6 backdrop-blur-md max-sm:p-0">
      <section
        className="kana-settings-shell relative flex h-[min(580px,92dvh)] w-[min(560px,100%)] flex-col overflow-hidden rounded-[36px] bg-raised max-sm:h-dvh max-sm:rounded-none"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-9 pb-4 max-sm:px-5 max-sm:pt-7">
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
                      className={`kana-focus kana-choice flex items-center justify-between gap-3 rounded-[26px] px-4 py-3 text-left ${active ? "is-selected" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-ink">{sample.name}</span>
                        <span className="mt-0.5 block text-[11.5px] text-muted">{text.officialSample}</span>
                      </span>
                      {active ? (
                        <span className="kana-check" aria-hidden="true"><CheckIcon className="size-3.5" /></span>
                      ) : (
                        <span className="size-6 shrink-0 rounded-full border-[3px] border-line-strong" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 border-t border-line">
                <SettingsRow label={text.voiceLabel} description={<>{draft.voiceEnabled ? common.on : common.off}<span className="mt-1 block">{text.voiceDownloadNote}</span></>}>
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
                    description={!draft.voiceEnabled ? text.voiceNotNeeded : deps.voice === "ok" ? text.voiceReady : deps.voice === "error" ? text.voiceNeedsAttention : deps.voice === "not_installed" ? text.voiceNotInstalled : deps.voice === "unsupported" ? text.voiceUnsupported : deps.voice === "loading" ? text.voiceInstalling : text.voicePreparedOnUse}
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

          {notice ? <p className="mt-4 rounded-[20px] border-2 border-danger/25 bg-danger/8 px-4 py-2 text-xs text-danger" role="status">{notice}</p> : null}
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
