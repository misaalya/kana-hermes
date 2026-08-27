"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { btnPrimary, btnSecondary, fieldLabel, inputBase } from "./ui";

type ModelControlPanelProps = {
  locale: UiLocale;
  onList(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelect(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
};

export function ModelControlPanel({ locale, onList, onSelect }: ModelControlPanelProps) {
  const copy = getCopy(locale).settings;
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);

  const load = async (refresh = false) => {
    setState("loading");
    setNotice("");
    setConfirmationPending(false);
    try {
      const next = await onList(refresh);
      setCatalog(next);
      const currentProvider =
        next.providers.find((item) => item.slug === next.provider) ??
        next.providers.find((item) => item.current) ??
        next.providers[0];
      setProvider(currentProvider?.slug ?? "");
      setModel(
        currentProvider?.models.includes(next.model)
          ? next.model
          : currentProvider?.models[0] ?? "",
      );
      setState("ready");
    } catch (error) {
      setState("error");
      setNotice(error instanceof Error ? error.message : copy.modelLoadFailed);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void load());
    // onList is a controller callback and remains stable for the dialog lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProvider = useMemo(
    () => catalog?.providers.find((item) => item.slug === provider) ?? null,
    [catalog, provider],
  );
  const unchanged = provider === catalog?.provider && model === catalog?.model;

  const chooseProvider = (value: string) => {
    setProvider(value);
    const next = catalog?.providers.find((item) => item.slug === value);
    setModel(next?.models.includes(catalog?.model ?? "") ? catalog?.model ?? "" : next?.models[0] ?? "");
    setNotice("");
    setConfirmationPending(false);
  };

  const apply = async (confirm = false) => {
    if (!provider || !model || unchanged) return;
    setState("saving");
    setNotice("");
    try {
      const result = await onSelect(provider, model, confirm);
      if (result.confirmationRequired) {
        setState("ready");
        setConfirmationPending(true);
        setNotice(result.message || copy.modelConfirmNeeded);
        return;
      }
      const refreshed = await onList(false);
      setCatalog(refreshed);
      setState("ready");
      setConfirmationPending(false);
      setNotice(result.message || (result.deferred
        ? copy.modelNextTurn
        : copy.modelChanged));
    } catch (error) {
      setState("error");
      setNotice(error instanceof Error ? error.message : copy.modelChangeFailed);
    }
  };

  if (state === "loading" && !catalog) {
    return <p className="text-[11px] text-muted">{copy.modelLoading}</p>;
  }

  if (!catalog?.providers.length) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-muted">
          {notice || copy.modelEmpty}
        </p>
        <button type="button" className={btnSecondary} onClick={() => void load(true)}>
          {copy.modelRefresh}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-accent/30 bg-accent/10 px-4 py-3">
        <p className="text-[9px] font-bold tracking-[0.14em] text-accent-strong uppercase">
          {copy.modelCurrent}
        </p>
        <p className="mt-1 break-all text-xs font-bold text-ink">{catalog.model || "—"}</p>
        <p className="mt-0.5 text-[10px] text-muted">
          {(catalog.providers.find((item) => item.slug === catalog.provider)?.name ?? catalog.provider) || "—"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={fieldLabel}>{copy.modelProvider}</span>
          <select className={`${inputBase} w-full`} value={provider} onChange={(event) => chooseProvider(event.target.value)} disabled={state === "saving"}>
            {catalog.providers.map((item) => (
              <option key={item.slug} value={item.slug}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={fieldLabel}>{copy.modelName}</span>
          <select className={`${inputBase} w-full`} value={model} onChange={(event) => { setModel(event.target.value); setNotice(""); setConfirmationPending(false); }} disabled={state === "saving"}>
            {(selectedProvider?.models ?? []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedProvider?.warning ? <p className="text-[10px] leading-relaxed text-muted">{selectedProvider.warning}</p> : null}
      {notice ? <p role="status" className={`text-[10px] leading-relaxed ${state === "error" ? "text-danger" : "text-muted"}`}>{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!model || (unchanged && !confirmationPending) || state === "saving"} onClick={() => void apply(confirmationPending)}>
          {state === "saving" ? copy.modelSwitching : confirmationPending ? copy.modelConfirmSwitch : unchanged ? copy.modelInUse : copy.modelUse}
        </button>
        <button type="button" className={btnSecondary} disabled={state === "saving"} onClick={() => void load(true)}>
          {copy.modelRefreshList}
        </button>
      </div>
      <p className="text-[9px] leading-relaxed text-faint">
        {copy.modelScope}
      </p>
    </div>
  );
}
