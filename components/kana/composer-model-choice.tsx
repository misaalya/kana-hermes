"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import type { AgentModelChoice } from "@/lib/preferences/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { MODAL_EXIT_MS, prefersReducedMotion } from "@/lib/ui/use-modal-presence";
import { BotIcon, ChevronDownIcon } from "./icons";
import { ComposerModelPicker } from "./composer-model-picker";

type Placement = { left: number; bottom: number; height: number };

export function ComposerModelChoice({ locale, sessionKey, connected, disabled, catalog, defaultModel, onList, onSelect, onNotice }: {
  locale: UiLocale;
  sessionKey?: string;
  connected: boolean;
  disabled: boolean;
  /** Cached catalog from the workspace; its model labels the button. */
  catalog: AgentModelCatalog | null;
  /** Kana's default for new conversations, marked in the list. */
  defaultModel: AgentModelChoice | null;
  onList(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelect(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
  /** A switch Hermes defers to the next turn still needs saying. */
  onNotice(text: string): void;
}) {
  const model = catalog?.model ?? "";
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  // Load the catalog once connected; later conversations reuse the cache.
  useEffect(() => {
    if (connected) void onList(false).catch(() => undefined);
  }, [connected, sessionKey, onList]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  // The native dialog is in the top layer, so a popover anchored to the pill
  // needs viewport coordinates rather than flow placement.
  const updatePlacement = useCallback(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setPlacement(null);
      return;
    }
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = 380;
    setPlacement({
      left: Math.min(Math.max(12, bounds.left), Math.max(12, window.innerWidth - 12 - width)),
      bottom: Math.round(window.innerHeight - bounds.top + 8),
      // One stable height per layout, never the list's own height. The list
      // scrolls inside it, so filtering or a short catalog cannot resize it.
      height: Math.max(160, Math.min(520, Math.round(bounds.top - 20))),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const follow = () => updatePlacement();
    window.addEventListener("resize", follow);
    document.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      document.removeEventListener("scroll", follow, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);
  const close = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
    }, MODAL_EXIT_MS);
  }, [closing]);
  const openPicker = () => {
    updatePlacement();
    setOpen(true);
  };
  const text = getCopy(locale).composer;
  const label = text.chooseModel;
  return <>
    <button ref={trigger} type="button" aria-label={label} title={model || label} disabled={disabled || !connected}
      aria-haspopup="dialog" aria-expanded={open}
      className="kana-model-pill kana-focus ml-auto flex min-h-10 min-w-0 max-w-[min(55%,260px)] items-center gap-1.5 rounded-full px-4 text-[12.5px]"
      onClick={openPicker}>
      <BotIcon className="size-[15px] shrink-0" />
      <span className="truncate">{connected && model ? model.split("/").pop() : label}</span>
      <ChevronDownIcon className="size-3.5 shrink-0" />
    </button>
    <dialog ref={dialog} aria-label={label} inert={closing || undefined}
      onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      style={placement ?? undefined}
      className={`kana-model-dialog kana-modal-panel fixed inset-auto m-0 flex h-[75dvh] max-h-[80dvh] w-full max-w-none flex-col overflow-hidden border-2 border-line-strong bg-surface text-ink backdrop:bg-transparent max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-auto max-lg:backdrop:bg-[var(--backdrop)] lg:w-[380px] ${closing ? "is-closing" : ""}`}>
      {open ? (
        <ComposerModelPicker
          locale={locale}
          catalog={catalog}
          defaultModel={defaultModel}
          onList={onList}
          onSelect={onSelect}
          onNotice={onNotice}
          onDone={close}
        />
      ) : null}
    </dialog>
  </>;
}
