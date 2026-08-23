import { memo } from "react";
import type { AgentCommandSuggestion } from "@/lib/agent/types";

type SlashCommandMenuProps = {
  suggestions: AgentCommandSuggestion[];
  loading: boolean;
  selectedIndex: number;
  onHighlight(index: number): void;
  onSelect(command: string): void;
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
}: SlashCommandMenuProps) {
  if (!loading && !suggestions.length) return null;

  const groups = suggestions.reduce<
    Array<{ name: string; items: AgentCommandSuggestion[] }>
  >((current, suggestion) => {
    const name = suggestion.group || "Hermes commands";
    const group = current.find((item) => item.name === name);
    if (group) group.items.push(suggestion);
    else current.push({ name, items: [suggestion] });
    return current;
  }, []);

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[44dvh] overflow-hidden rounded-2xl border border-line bg-raised"
      id="kana-command-menu"
      role="listbox"
      aria-label="Hermes commands"
    >
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
        <span className="text-[10px] font-bold tracking-wider text-ink-dim uppercase">Hermes commands</span>
        <small className="text-[10px] text-faint">{loading ? "Loading…" : "Tab selects the first match"}</small>
      </div>
      <div className="max-h-[38dvh] overflow-y-auto p-1.5">
        {groups.map((group) => (
          <section key={group.name} className="mb-1 last:mb-0">
            <p className="px-2 py-1 text-[9px] font-bold tracking-wider text-faint uppercase">{group.name}</p>
            {group.items.map((suggestion) => {
              const index = suggestions.indexOf(suggestion);
              const selected = index === selectedIndex;
              const unavailable = suggestion.availability === "unavailable";
              return (
                <button
                  className={`grid w-full grid-cols-[minmax(96px,0.7fr)_minmax(0,1.6fr)_auto] items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    selected ? "bg-accent/15" : "hover:bg-surface"
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
                  <span className="truncate font-mono text-xs font-semibold text-accent-strong">{suggestion.display}</span>
                  <span className="truncate text-[11px] text-muted">
                    {suggestion.description ||
                      (suggestion.kind === "skill"
                        ? "Hermes skill"
                        : "Hermes command")}
                  </span>
                  <span className="rounded-full border border-line-strong px-1.5 py-px text-[8px] font-bold tracking-wider text-faint uppercase max-md:hidden">
                    {unavailable ? "surface" : suggestion.kind}
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
