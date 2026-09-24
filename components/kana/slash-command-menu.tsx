import { memo } from "react";
import type { AgentCommandSuggestion } from "@/lib/agent/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

type SlashCommandMenuProps = {
  suggestions: AgentCommandSuggestion[];
  loading: boolean;
  selectedIndex: number;
  onHighlight(index: number): void;
  onSelect(command: string): void;
  locale: UiLocale;
};

/**
 * Memoized: hidden while typing plain messages, and cheap to skip otherwise.
 */
export const SlashCommandMenu = memo(function SlashCommandMenu({
  suggestions,
  loading,
  selectedIndex,
  onHighlight,
  onSelect,
  locale,
}: SlashCommandMenuProps) {
  const copy = getCopy(locale);
  if (!loading && !suggestions.length) return null;

  const groups = suggestions.reduce<
    Array<{ name: string; items: AgentCommandSuggestion[] }>
  >((current, suggestion) => {
    const name = suggestion.group || copy.slash.commands;
    const group = current.find((item) => item.name === name);
    if (group) group.items.push(suggestion);
    else current.push({ name, items: [suggestion] });
    return current;
  }, []);

  return (
    <div
      className="kana-panel absolute bottom-full left-0 right-0 z-30 mb-3 max-h-[44dvh] overflow-hidden rounded-[28px] animate-kana-in"
      id="kana-command-menu"
      role="listbox"
      aria-label={copy.slash.commands}
    >
      <div className="flex items-center justify-between border-b-[3px] border-dotted border-line px-4 py-3">
        <span className="kana-label-bubble">{copy.slash.ask}</span>
        <small className="text-[9px] text-faint">{loading ? copy.slash.finding : copy.slash.navigate}</small>
      </div>
      <div className="max-h-[38dvh] overflow-y-auto p-2">
        {groups.map((group) => (
          <section key={group.name} className="mb-1 last:mb-0">
            <p className="px-2.5 py-1.5 text-[11px] font-extrabold text-muted">{group.name}</p>
            {group.items.map((suggestion) => {
              const index = suggestions.indexOf(suggestion);
              const selected = index === selectedIndex;
              const unavailable = suggestion.availability === "unavailable";
              return (
                <button
                  className={`kana-focus grid w-full grid-cols-[minmax(100px,0.7fr)_minmax(0,1.6fr)_auto] items-center gap-3 rounded-full px-4 py-2.5 text-left transition-colors ${
                    selected ? "bg-accent text-on-accent" : "hover:bg-surface-strong"
                  } ${unavailable ? "opacity-50" : ""}`}
                  id={`kana-command-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-disabled={unavailable}
                  key={`${suggestion.kind}:${suggestion.text}`}
                  onMouseEnter={() => onHighlight(index)}
                  onClick={() => onSelect(suggestion.text)}
                >
                  <span className={`truncate text-xs font-extrabold ${selected ? "" : "text-accent-strong"}`}>{suggestion.display}</span>
                  <span className={`truncate text-[11px] ${selected ? "" : "text-muted"}`}>
                    {suggestion.description ||
                      (suggestion.kind === "skill"
                        ? copy.slash.skill
                        : copy.slash.command)}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold max-md:hidden ${selected ? "bg-white/25" : "bg-surface-strong text-muted"}`}>
                    {unavailable ? copy.slash.unavailable : suggestion.kind === "skill" ? copy.slash.skill : copy.slash.command}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
});
