"use client";

import { useEffect, useRef, useState } from "react";
import { AvatarIcon, CheckIcon, MoreIcon, PlusIcon } from "./icons";

// Settings → Avatar pieces, after the Clara wardrobe cards: a picture over a
// short name, a blue ring and check badge on the chosen one, and a dashed
// card at the end of each grid that adds a new one.

/** One wardrobe grid; cards wrap and keep their width. */
export function WardrobeGrid({ label, wide = false, children }: {
  label: string;
  /** Wider cards, for 16:10 background previews. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`kana-wardrobe ${wide ? "is-wide" : ""}`}>
      {children}
    </div>
  );
}

export type AvatarCardMenu = {
  label: string;
  /** A line above the actions, such as the package size. */
  detail?: string;
  items: Array<{ label: string; danger?: boolean; onSelect(): void }>;
};

export function AvatarCard({ name, portrait, active, disabled, onSelect, menu }: {
  name: string;
  /** Taken from the stage the last time this avatar was shown. */
  portrait?: string;
  active: boolean;
  disabled?: boolean;
  onSelect(): void;
  menu?: AvatarCardMenu;
}) {
  return (
    <div className={`kana-choice kana-wardrobe-card rounded-[26px] ${active ? "is-selected" : ""}`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={name}
        disabled={disabled}
        className="kana-focus flex w-full flex-col items-center gap-2 rounded-[23px] px-2 pb-3 pt-4"
        onClick={onSelect}
      >
        <span className="kana-portrait">
          {portrait ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL
            <img src={portrait} alt="" draggable={false} />
          ) : (
            <AvatarIcon className="size-[46%]" />
          )}
        </span>
        <span className="max-w-full truncate px-1 text-[12.5px] font-extrabold text-ink">{name}</span>
      </button>
      {active ? <span className="kana-check" aria-hidden="true"><CheckIcon className="size-3.5" /></span> : null}
      {menu ? <CardMenu menu={menu} /> : null}
    </div>
  );
}

function CardMenu({ menu }: { menu: AvatarCardMenu }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Captured so Escape closes only the menu, not Settings around it.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="absolute left-1.5 top-1.5 z-[2]">
      <button
        type="button"
        className={`kana-focus grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-surface-strong hover:text-ink ${open ? "bg-surface-strong text-ink" : ""}`}
        aria-label={menu.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon className="size-4" />
      </button>
      {open ? (
        <div role="menu" className="kana-popover absolute left-0 top-8 min-w-36 rounded-[22px] bg-raised p-1.5 animate-kana-in">
          {menu.detail ? <p className="px-3.5 pb-1 pt-1.5 text-[11px] font-bold text-faint">{menu.detail}</p> : null}
          {menu.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`w-full whitespace-nowrap rounded-full px-3.5 py-2 text-left text-[13px] font-bold ${
                item.danger ? "text-danger hover:bg-danger/10" : "text-ink-dim hover:bg-surface-strong hover:text-ink"
              }`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The dashed card at the end of a grid: import an avatar, upload a background. */
export function AddCard({ label, busy, wide = false, onClick }: {
  label: string;
  busy?: boolean;
  wide?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="kana-focus kana-wardrobe-add flex flex-col items-center justify-center gap-2 rounded-[26px] px-3 py-4 text-center"
      disabled={busy}
      onClick={onClick}
    >
      <span className={`grid place-items-center rounded-full bg-accent text-on-accent ${wide ? "size-9" : "size-11"}`} aria-hidden="true">
        <PlusIcon className={wide ? "size-4" : "size-5"} />
      </span>
      <span className="text-[12.5px] font-extrabold text-ink">{label}</span>
    </button>
  );
}
