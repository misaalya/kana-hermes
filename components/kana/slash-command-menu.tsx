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
      className="slash-command-menu"
      id="kana-command-menu"
      role="listbox"
      aria-label="Hermes commands"
    >
      <div className="slash-command-heading">
        <span>Hermes commands</span>
        <small>{loading ? "Loading…" : "Tab selects the first match"}</small>
      </div>
      <div className="slash-command-groups">
        {groups.map((group) => (
          <section className="slash-command-group" key={group.name}>
            <p>{group.name}</p>
            {group.items.map((suggestion) => {
              const index = suggestions.indexOf(suggestion);
              return (
                <button
                  className={[
                    suggestion.availability === "unavailable"
                      ? "unavailable"
                      : "",
                    index === selectedIndex ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  id={`kana-command-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  key={`${suggestion.kind}:${suggestion.text}`}
                  onMouseEnter={() => onHighlight(index)}
                  onClick={() => onSelect(suggestion.text)}
                >
                  <span className="slash-command-name">{suggestion.display}</span>
                  <span className="slash-command-description">
                    {suggestion.description ||
                      (suggestion.kind === "skill"
                        ? "Hermes skill"
                        : "Hermes command")}
                  </span>
                  <span className={`slash-command-kind ${suggestion.kind}`}>
                    {suggestion.availability === "unavailable"
                      ? "surface"
                      : suggestion.kind}
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
