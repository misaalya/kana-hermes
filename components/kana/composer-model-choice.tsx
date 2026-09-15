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
      className="kana-focus ml-auto flex min-h-10 min-w-0 max-w-[min(55%,260px)] items-center gap-1 rounded-lg px-2 text-[13px] hover:bg-white/12 disabled:opacity-40"
      onClick={() => setOpen(true)}>
      <span className="truncate">{connected && model ? model.split("/").pop() : label}</span><span aria-hidden="true">⌄</span>
    </button>
    <dialog ref={dialog} aria-label={label} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
      className="kana-model-dialog fixed inset-0 m-auto max-h-[80dvh] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/25">
      {open ? <>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold">{label}</h2>
          <button type="button" className="kana-focus min-h-10 px-3" onClick={() => setOpen(false)} aria-label={text.closeModelChooser}>×</button>
        </div>
        <ModelControlPanel locale={locale} catalog={catalog} onList={onList} onSelect={onSelect} />
      </> : null}
    </dialog>
  </>;
}
