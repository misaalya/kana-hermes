"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "./icons";

export type KanaSelectOption = { value: string; label: string };

type KanaSelectProps = {
  /** Accessible name; the visible label, if any, is rendered by the caller. */
  label: string;
  value: string;
  options: ReadonlyArray<KanaSelectOption>;
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
  /** Adds a filter field above the list, for long lists such as model catalogs. */
  search?: { placeholder: string; empty: string };
  /** Custom list row; the option's `label` stays its accessible name. */
  renderOption?(option: KanaSelectOption): React.ReactNode;
};

type Placement = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 8;
const EDGE = 12;
const MIN_WIDTH = 260;
const MAX_HEIGHT = 340;

function matches(option: KanaSelectOption, query: string) {
  const text = option.label.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((part) => text.includes(part));
}

function filterOptions(options: ReadonlyArray<KanaSelectOption>, query: string) {
  const trimmed = query.trim();
  return trimmed ? options.filter((option) => matches(option, trimmed)) : options;
}

/** Beside the trigger, flipped upward when the space below is short. */
function measure(trigger: HTMLElement | null): Placement | null {
  const bounds = trigger?.getBoundingClientRect();
  if (!bounds) return null;
  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), window.innerWidth - EDGE * 2);
  const left = Math.min(Math.max(EDGE, bounds.left), window.innerWidth - EDGE - width);
  const below = window.innerHeight - bounds.bottom - GAP - EDGE;
  const above = bounds.top - GAP - EDGE;
  if (below >= 220 || below >= above) {
    return { left, width, top: bounds.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) };
  }
  return { left, width, bottom: window.innerHeight - bounds.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) };
}

/**
 * A themed dropdown in place of a native `<select>`: a pill trigger
 * (role="combobox") that opens a listbox rendered in the same DOM subtree, so
 * it also works inside modal `<dialog>`s and focus-trapped panels. The list is
 * position: fixed so a scrolling dialog cannot clip it.
 */
export function KanaSelect({ label, value, options, onChange, disabled, className, search, renderOption }: KanaSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const open = placement !== null;
  const selected = options.find((option) => option.value === value);
  const visible = filterOptions(options, query);
  const selectedVisible = visible.findIndex((option) => option.value === value);

  const show = (offset = 0) => {
    if (disabled || !options.length) return;
    const index = options.findIndex((option) => option.value === value);
    setQuery("");
    setActive(Math.min(options.length - 1, Math.max(0, index + offset)));
    setPlacement(measure(triggerRef.current));
  };
  const close = (refocus = true) => {
    setPlacement(null);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (option: KanaSelectOption | undefined) => {
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  // Follow the trigger while the window resizes or any ancestor scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const follow = (event: Event) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setPlacement(measure(triggerRef.current));
    };
    window.addEventListener("resize", follow);
    document.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      document.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (search ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPlacement(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open, search]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const last = visible.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      setActive(Math.min(last, Math.max(0, index)));
    };
    switch (event.key) {
      case "ArrowDown": return move(active + 1);
      case "ArrowUp": return move(active - 1);
      case "PageDown": return move(active + 8);
      case "PageUp": return move(active - 8);
      case "Enter":
        event.preventDefault();
        return choose(visible[active]);
      case "Escape":
        // Keep the surrounding dialog open: only the list closes.
        event.preventDefault();
        event.stopPropagation();
        return close();
      case "Tab":
        return close();
    }
    // The filter field keeps Home/End, Space and typed characters for itself.
    if (search) return;
    switch (event.key) {
      case "Home": return move(0);
      case "End": return move(last);
      case " ":
        event.preventDefault();
        return choose(visible[active]);
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = event.timeStamp;
      const state = typeahead.current;
      state.text = now - state.at < 700 ? state.text + event.key.toLowerCase() : event.key.toLowerCase();
      state.at = now;
      const order = [...visible.keys()].map((offset) => (active + 1 + offset) % visible.length);
      const match = order.find((index) => visible[index].label.toLowerCase().startsWith(state.text));
      if (match !== undefined) setActive(match);
    }
  };

  const activeId = visible[active] ? `${listId}-${active}` : undefined;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        className="kana-select kana-focus"
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            show(event.key === "ArrowUp" ? -1 : 0);
          }
        }}
      >
        <span className="min-w-0 truncate">{selected?.label ?? ""}</span>
        <span className="kana-select-chevron" aria-hidden="true"><ChevronDownIcon className="size-4" /></span>
      </button>
      {placement ? (
        <div className="kana-select-popup" style={placement}>
          {search ? (
            <label className="kana-select-search">
              <SearchIcon className="size-4 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={search.placeholder}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                autoComplete="off"
                spellCheck={false}
                placeholder={search.placeholder}
                value={query}
                onKeyDown={onListKeyDown}
                onChange={(event) => {
                  setQuery(event.target.value);
                  const filtered = filterOptions(options, event.target.value);
                  setActive(Math.max(0, filtered.findIndex((option) => option.value === value)));
                }}
              />
            </label>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={search ? undefined : activeId}
            className="kana-select-list"
            onKeyDown={onListKeyDown}
          >
            {visible.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-label={renderOption ? option.label : undefined}
                aria-selected={index === selectedVisible}
                className={`kana-select-option ${index === active ? "is-active" : ""}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{renderOption ? renderOption(option) : option.label}</span>
                {index === selectedVisible ? <CheckIcon className="size-4 shrink-0" /> : null}
              </li>
            ))}
          </ul>
          {!visible.length && search ? <p className="kana-select-empty" role="status">{search.empty}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
