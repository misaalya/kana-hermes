"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { KanaSelect, type KanaSelectOption } from "./kana-select";
import { btnPrimary, btnSecondary, fieldLabel } from "./ui";

type ModelControlPanelProps = {
  locale: UiLocale;
  /** Latest catalog from the workspace cache; a background refresh replaces what is shown. */
  catalog?: AgentModelCatalog | null;
  onList(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelect(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
};

function currentSelection(catalog: AgentModelCatalog) {
  const provider =
    catalog.providers.find((item) => item.slug === catalog.provider) ??
    catalog.providers.find((item) => item.current) ??
    catalog.providers[0];
  return {
    provider: provider?.slug ?? "",
    model: provider?.models.includes(catalog.model) ? catalog.model : provider?.models[0] ?? "",
  };
}

export function ModelControlPanel({ locale, catalog: cachedCatalog, onList, onSelect }: ModelControlPanelProps) {
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
      const selection = currentSelection(next);
      setCatalog(next);
      setProvider(selection.provider);
      setModel(selection.model);
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

  // A background refresh finished with a different catalog: show it, and keep
  // the user's choice unless they had not changed anything yet.
  const [adoptedCatalog, setAdoptedCatalog] = useState(cachedCatalog);
  if (cachedCatalog !== adoptedCatalog) {
    setAdoptedCatalog(cachedCatalog);
    if (cachedCatalog && catalog && cachedCatalog !== catalog && state === "ready") {
      const untouched = provider === catalog.provider && model === catalog.model;
      setCatalog(cachedCatalog);
      if (untouched || !cachedCatalog.providers.some((item) => item.slug === provider && item.models.includes(model))) {
        const selection = currentSelection(cachedCatalog);
        setProvider(selection.provider);
        setModel(selection.model);
      }
    }
  }

  const selectedProvider = useMemo(
    () => catalog?.providers.find((item) => item.slug === provider) ?? null,
    [catalog, provider],
  );
  const unchanged = provider === catalog?.provider && model === catalog?.model;

  const activeBadge = <span className="kana-select-badge">{copy.modelActive}</span>;
  const renderProvider = (option: KanaSelectOption) => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {option.label}
      {option.value === catalog?.provider ? activeBadge : null}
    </span>
  );
  // Long ids such as "fireworks.ai/accounts/fireworks/models/deepseek-v4" read
  // better as the model's own name over its muted namespace.
  const renderModel = (option: KanaSelectOption) => {
    const cut = option.value.lastIndexOf("/");
    return (
      <span className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {cut >= 0 ? option.value.slice(cut + 1) : option.value}
          {provider === catalog?.provider && option.value === catalog?.model ? activeBadge : null}
        </span>
        {cut > 0 ? <span className="text-[11px] opacity-70">{option.value.slice(0, cut)}</span> : null}
      </span>
    );
  };

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
    <div className="@container space-y-4">
      <div className="grid gap-3 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-1.5">
          <span className={fieldLabel} aria-hidden="true">{copy.modelProvider}</span>
          <KanaSelect
            label={copy.modelProvider}
            value={provider}
            options={catalog.providers.map((item) => ({ value: item.slug, label: item.name }))}
            onChange={chooseProvider}
            disabled={state === "saving"}
            renderOption={renderProvider}
            search={catalog.providers.length > 8 ? { placeholder: copy.providerSearch, empty: copy.modelSearchEmpty } : undefined}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <span className={fieldLabel} aria-hidden="true">{copy.modelName}</span>
          <KanaSelect
            label={copy.modelName}
            value={model}
            options={(selectedProvider?.models ?? []).map((item) => ({ value: item, label: item }))}
            onChange={(next) => { setModel(next); setNotice(""); setConfirmationPending(false); }}
            disabled={state === "saving"}
            renderOption={renderModel}
            search={{ placeholder: copy.modelSearch, empty: copy.modelSearchEmpty }}
          />
        </div>
      </div>

      {selectedProvider?.warning ? <p className="text-[11px] leading-relaxed text-muted">{selectedProvider.warning}</p> : null}
      {notice ? <p role="status" className={`text-[11px] leading-relaxed ${state === "error" ? "text-danger" : "text-muted"}`}>{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!model || (unchanged && !confirmationPending) || state === "saving"} onClick={() => void apply(confirmationPending)}>
          {state === "saving" ? copy.modelSwitching : confirmationPending ? copy.modelConfirmSwitch : unchanged ? copy.modelInUse : copy.modelUse}
        </button>
        <button type="button" className={btnSecondary} disabled={state === "saving"} onClick={() => void load(true)}>
          {copy.modelRefreshList}
        </button>
      </div>
    </div>
  );
}
