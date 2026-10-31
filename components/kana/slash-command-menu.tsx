import { memo, useEffect, useRef } from "react";
import type { AgentCommandSuggestion } from "@/lib/agent/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

/** Session groups from Kana and Hermes read as one plain Command group. */
const PLAIN_COMMAND_GROUPS = new Set([
  "command",
  "commands",
  "kana",
  "kana & session",
  "kana & sesi",
  "session",
]);

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
  const listRef = useRef<HTMLDivElement>(null);

  const groupName = (suggestion: AgentCommandSuggestion): string => {
    const raw = suggestion.group || copy.slash.commands;
    return suggestion.kind === "command" && PLAIN_COMMAND_GROUPS.has(raw.toLowerCase())
      ? copy.slash.commandGroup
      : raw;
  };

  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`#kana-command-option-${selectedIndex}`);
    if (!list || !option) return;
    const listRect = list.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const topInset = listRect.top + 6;
    const bottomInset = listRect.bottom - 6;
    if (optionRect.top < topInset) list.scrollTop += optionRect.top - topInset;
    else if (optionRect.bottom > bottomInset) list.scrollTop += optionRect.bottom - bottomInset;
  }, [selectedIndex, suggestions]);

  if (!loading && !suggestions.length) return null;

  const groups = suggestions.reduce<
    Array<{ name: string; items: AgentCommandSuggestion[] }>
  >((current, suggestion) => {
    const name = groupName(suggestion);
    const group = current.find((item) => item.name === name);
    if (group) group.items.push(suggestion);
    else current.push({ name, items: [suggestion] });
    return current;
  }, []);

  return (
    <div
      className="kana-panel absolute bottom-full left-0 z-30 mb-3 max-h-[52dvh] w-full max-w-[620px] overflow-hidden rounded-[20px] animate-kana-in"
      id="kana-command-menu"
      role="listbox"
      aria-label={copy.slash.commands}
    >
      <div ref={listRef} id="kana-command-list" className="max-h-[46dvh] overflow-y-auto p-1.5">
        {groups.map((group, groupIndex) => (
          <section
            key={group.name}
            className={groupIndex > 0 ? "mt-1 border-t border-line/70 pt-1" : ""}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-faint">
              {group.name}
            </p>
            {group.items.map((suggestion) => {
              const index = suggestions.indexOf(suggestion);
              const selected = index === selectedIndex;
              const unavailable = suggestion.availability === "unavailable";
              return (
                <button
                  className={`kana-focus flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors ${
                    selected ? "bg-ink/10" : "hover:bg-surface-strong"
                  } ${unavailable ? "opacity-50" : ""}`}
                  id={`kana-command-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-disabled={unavailable}
                  key={`${suggestion.kind}:${suggestion.text}`}
                  onMouseMove={() => {
                    if (!selected) onHighlight(index);
                  }}
                  onClick={() => onSelect(suggestion.text)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-extrabold text-ink">
                      {suggestion.display}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {suggestion.description ||
                        (suggestion.kind === "skill"
                          ? copy.slash.skill
                          : copy.slash.command)}
                    </span>
                  </span>
                  {unavailable ? (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-muted">
                      {copy.slash.unavailable}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        ))}
        {loading && !groups.length ? (
          <p className="px-3 py-4 text-[11px] text-muted">{copy.slash.finding}</p>
        ) : null}
      </div>
      <div className="hidden items-center justify-between gap-3 border-t border-line px-4 py-2 text-[10px] text-faint sm:flex">
        <span>{copy.slash.navigate}</span>
        {loading ? <span className="animate-kana-pulse">{copy.slash.finding}</span> : null}
      </div>
    </div>
  );
});
