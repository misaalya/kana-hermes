import type { SubtitleLanguage } from "./types";

export type SupportedSubtitleLanguage = {
  code: SubtitleLanguage;
  label: string;
  nativeLabel: string;
};

export const SUPPORTED_SUBTITLE_LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
] satisfies SupportedSubtitleLanguage[];

export const DEFAULT_SUBTITLE_LANGUAGE: SubtitleLanguage = "en";

export function subtitleLanguageName(code: SubtitleLanguage): string {
  return (
    SUPPORTED_SUBTITLE_LANGUAGES.find((language) => language.code === code)
      ?.label ?? code
  );
}

