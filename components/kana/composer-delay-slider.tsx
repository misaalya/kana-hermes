"use client";

import { useState, type CSSProperties } from "react";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { SettingsSegmented } from "./settings-layout";

const STEP_SECONDS = 5;
/** The old preset ceiling: real delays are short, so the track stays readable. */
const DEFAULT_MAX_SECONDS = 120;
/** One tap for the delays people actually pick; the track covers the rest. */
const PRESETS = [0, 5, 15, 30, 60, 120] as const;

/** The chatbar delay: preset chips for the common values, and a thin track
 * with a round thumb for any other 5-second step. A native range input keeps
 * keyboard and screen-reader behaviour; the visible thumb mirrors it. */
export function ComposerDelaySlider({
  locale,
  value,
  onChange,
}: {
  locale: UiLocale;
  value: number;
  onChange(value: number): void;
}) {
  const copy = getCopy(locale).settings;
  const seconds = Math.max(0, Math.round(value));
  // A stored delay above the usual range keeps its own scale for this dialog,
  // so the thumb never starts pinned under a value it does not represent.
  const [maximum] = useState(() =>
    Math.max(DEFAULT_MAX_SECONDS, Math.ceil(seconds / STEP_SECONDS) * STEP_SECONDS),
  );
  const format = (duration: number) =>
    duration === 0
      ? copy.composerDelayOff
      : duration % 60 === 0
        ? `${duration / 60} ${copy.composerDelayMinutesShort}`
        : `${duration} ${copy.composerDelaySecondsShort}`;
  const label = format(seconds);
  const progress = Math.min(1, seconds / maximum);

  return (
    <div className="kana-delay-frame w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SettingsSegmented
          label={copy.composerDelayTitle}
          value={String(seconds)}
          options={PRESETS.map((preset) => ({ value: String(preset), label: format(preset) }))}
          onChange={(next) => onChange(Number(next))}
        />
        <output aria-hidden="true" className="kana-delay-value tabular-nums">
          {label}
        </output>
      </div>
      <div
        className="kana-delay-slider mt-3"
        style={{ "--kana-delay-progress": progress } as CSSProperties}
      >
        <span className="kana-delay-track" aria-hidden="true">
          <span className="kana-delay-fill" />
        </span>
        <input
          type="range"
          min={0}
          max={maximum}
          step={STEP_SECONDS}
          value={seconds}
          aria-label={copy.composerDelayTitle}
          aria-valuetext={label}
          className="kana-delay-range"
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <span className="kana-delay-thumb" aria-hidden="true" />
      </div>
      <div className="kana-delay-labels mt-1 flex justify-between text-[10px] font-bold text-faint" aria-hidden="true">
        <span>{copy.composerDelayOff}</span>
        <span>{format(maximum)}</span>
      </div>
    </div>
  );
}
