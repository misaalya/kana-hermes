"use client";

import { useState, type CSSProperties } from "react";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

const STEP_SECONDS = 5;
/** The old preset ceiling: real delays are short, so the ruler stays readable. */
const DEFAULT_MAX_SECONDS = 120;
const TICK_COUNT = 41;

/** The chatbar delay as a tick ruler. A native range input keeps keyboard and
 * screen-reader behaviour; the visible thumb mirrors its position. */
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
  const passedTicks = progress * (TICK_COUNT - 1);

  return (
    <div className="kana-delay-frame w-full">
      <div className="flex min-h-6 items-center justify-end">
        <output aria-hidden="true" className="text-[15px] font-extrabold tabular-nums text-ink">
          {label}
        </output>
      </div>
      <div
        className="kana-delay-slider mt-1.5"
        style={{ "--kana-delay-progress": progress * 100 } as CSSProperties}
      >
        <span className="kana-delay-fill" aria-hidden="true" />
        <span className="kana-delay-ticks" aria-hidden="true">
          {Array.from({ length: TICK_COUNT }, (_, index) => (
            <span
              key={index}
              className={`kana-delay-tick${index <= passedTicks + 0.001 ? " is-past" : ""}`}
            />
          ))}
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
