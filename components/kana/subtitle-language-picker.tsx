"use client";

import { SUPPORTED_SUBTITLE_LANGUAGES } from "@/lib/presentation/languages";
import { chipBase, fieldLabel } from "./ui";

type SubtitleLanguagePickerProps = {
  value: string;
  onChange(value: string): void;
};

/**
 * Fixed preset chips plus a free-form custom field — Hermes translates
 * subtitles into any language name the user types.
 */
export function SubtitleLanguagePicker({ value, onChange }: SubtitleLanguagePickerProps) {
  const presetActive = SUPPORTED_SUBTITLE_LANGUAGES.some((lang) => lang.code === value);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common subtitle languages">
        {SUPPORTED_SUBTITLE_LANGUAGES.map((lang) => {
          const active = value === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              aria-pressed={active}
              className={`${chipBase} ${active ? "border-accent bg-accent text-on-accent" : "border-line-strong text-ink-dim hover:border-accent hover:text-accent-strong"}`}
              onClick={() => onChange(lang.code)}
            >
              {lang.nativeLabel}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Custom language</span>
        <input
          type="text"
          className="min-h-9 w-full rounded-xl border border-line-strong bg-transparent px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          value={presetActive ? "" : value}
          placeholder="Or type any language…"
          aria-label="Custom subtitle language"
          onChange={(event) => onChange(event.target.value.trim())}
        />
      </label>
      <p className="text-[11px] leading-relaxed text-faint">
        Hermes writes subtitles in this language. Speech stays Japanese; history is never retranslated.
      </p>
    </div>
  );
}
