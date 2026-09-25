"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { ModelControlPanel } from "./model-control-panel";

export function ComposerModelChoice({ locale, sessionKey, connected, disabled, catalog, onList, onSelect }: {
  locale: UiLocale;
  sessionKey?: string;
  connected: boolean;
  disabled: boolean;
  /** Cached catalog from the workspace; its model labels the button. */
  catalog: AgentModelCatalog | null;
  onList(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelect(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
}) {
  const model = catalog?.model ?? "";
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // Load the catalog once connected; later conversations reuse the cache.
  useEffect(() => {
    if (connected) void onList(false).catch(() => undefined);
  }, [connected, sessionKey, onList]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const text = getCopy(locale).composer;
  const label = text.chooseModel;
  return <>
    <button type="button" aria-label={label} title={model || label} disabled={disabled || !connected}
      aria-haspopup="dialog" aria-expanded={open}
      className="kana-model-pill kana-focus ml-auto flex min-h-10 min-w-0 max-w-[min(55%,260px)] items-center gap-1.5 rounded-full px-4 text-[12.5px]"
      onClick={() => setOpen(true)}>
      <span className="truncate">{connected && model ? model.split("/").pop() : label}</span><span aria-hidden="true">⌄</span>
    </button>
    <dialog ref={dialog} aria-label={label} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
      className="kana-model-dialog fixed inset-0 m-auto max-h-[80dvh] w-[min(440px,calc(100vw-24px))] overflow-y-auto border-0 bg-surface p-6 text-ink backdrop:bg-[var(--backdrop)]">
      {open ? <>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold">{label}</h2>
          <button type="button" className="kana-focus grid size-9 place-items-center rounded-full bg-surface-strong text-lg leading-none" onClick={() => setOpen(false)} aria-label={text.closeModelChooser}>×</button>
        </div>
        <ModelControlPanel locale={locale} catalog={catalog} onList={onList} onSelect={onSelect} />
      </> : null}
    </dialog>
  </>;
}
