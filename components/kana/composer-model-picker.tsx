"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentModelCatalog, AgentModelSwitchResult } from "@/lib/agent/types";
import type { AgentModelChoice } from "@/lib/preferences/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { CheckIcon, CloseIcon, ResetIcon, SearchIcon } from "./icons";
import { btnPrimary, btnSecondary } from "./ui";

type ComposerModelPickerProps = {
  locale: UiLocale;
  catalog: AgentModelCatalog | null;
  defaultModel: AgentModelChoice | null;
  onList(refresh?: boolean): Promise<AgentModelCatalog>;
  onSelect(provider: string, model: string, confirm?: boolean): Promise<AgentModelSwitchResult>;
  /** A switch that Hermes defers to the next turn still needs saying. */
  onNotice(text: string): void;
  onDone(): void;
};

type ModelRow = {
  key: string;
  provider: string;
  providerName: string;
  model: string;
  current: boolean;
  isDefault: boolean;
};

function matches(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

/**
 * The composer's model picker, after the compact chat-app picker: a flat,
 * searchable list with the provider under each model and a check on the one
 * in use. A row applies at once; only Hermes's cost confirmation stands
 * between a row and the switch.
 */
export function ComposerModelPicker({
  locale,
  catalog,
  defaultModel,
  onList,
  onSelect,
  onNotice,
  onDone,
}: ComposerModelPickerProps) {
  const copy = getCopy(locale).settings;
  const composer = getCopy(locale).composer;
  const [loaded, setLoaded] = useState<AgentModelCatalog | null>(catalog);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(!catalog);
  const [applying, setApplying] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    provider: string;
    model: string;
    message: string;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const data = catalog ?? loaded;
  const rows = useMemo<ModelRow[]>(() => {
    if (!data) return [];
    return data.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.slug}\u0000${model}`,
        provider: provider.slug,
        providerName: provider.name,
        model,
        current: provider.slug === data.provider && model === data.model,
        isDefault: provider.slug === defaultModel?.provider && model === defaultModel.model,
      })),
    );
  }, [data, defaultModel]);
  const visible = useMemo(
    () => rows.filter((row) => matches(`${row.model} ${row.providerName}`, query)),
    [rows, query],
  );
  const activeIndex = visible.length ? Math.min(active, visible.length - 1) : 0;

  // A null catalog can still arrive from a slow session; the parent already
  // keeps one, so this is the cold-start path.
  useEffect(() => {
    if (data) return;
    let live = true;
    void onList(false)
      .then((next) => {
        if (live) setLoaded(next);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : copy.modelLoadFailed);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [copy.modelLoadFailed, data, onList]);

  useEffect(() => {
    // Phones keep the keyboard down until the search is tapped; the list
    // takes initial focus there. Desktops land in the filter.
    if (window.matchMedia("(min-width: 1024px)").matches) searchRef.current?.focus();
    const frame = window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[data-current="true"]')?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!visible.length) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, visible.length]);

  const refresh = async () => {
    setError("");
    setLoading(true);
    try {
      setLoaded(await onList(true));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.modelLoadFailed);
    } finally {
      setLoading(false);
    }
  };

  const apply = async (row: ModelRow, confirm = false) => {
    if (applying) return;
    if (row.current && !confirm) {
      onDone();
      return;
    }
    setError("");
    setConfirmation(null);
    setApplying(row.key);
    try {
      const result = await onSelect(row.provider, row.model, confirm);
      if (result.confirmationRequired) {
        setApplying("");
        setConfirmation({
          provider: row.provider,
          model: row.model,
          message: result.message || copy.modelConfirmNeeded,
        });
        return;
      }
      if (result.deferred) onNotice(copy.modelNextTurn);
      onDone();
    } catch (reason) {
      setApplying("");
      setError(reason instanceof Error ? reason.message : copy.modelChangeFailed);
    }
  };

  const confirmSwitch = () => {
    if (!confirmation) return;
    const row = rows.find(
      (item) => item.provider === confirmation.provider && item.model === confirmation.model,
    );
    if (row) void apply(row, true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(visible.length - 1, activeIndex + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (event.key === "Enter" && visible[activeIndex]) {
      event.preventDefault();
      void apply(visible[activeIndex]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 p-3 pb-2">
        <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-strong px-3.5">
          <SearchIcon className="size-4 shrink-0 text-accent" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            aria-label={copy.modelSearch}
            placeholder={copy.modelSearch}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-ink outline-none placeholder:text-muted"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <button
          type="button"
          aria-label={copy.modelRefreshList}
          title={copy.modelRefreshList}
          disabled={loading || Boolean(applying)}
          onClick={() => void refresh()}
          className="kana-focus grid size-9 shrink-0 place-items-center rounded-full bg-surface-strong text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <ResetIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={composer.closeModelChooser}
          title={composer.closeModelChooser}
          onClick={onDone}
          className="kana-focus grid size-9 shrink-0 place-items-center rounded-full bg-surface-strong text-muted transition-colors hover:text-ink"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="shrink-0 px-4 pb-2 text-[11.5px] font-bold leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
      {loading && !data ? (
        <p role="status" className="px-4 pb-6 pt-2 text-[12px] font-bold text-muted">{copy.modelLoading}</p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label={copy.modelName}
          aria-activedescendant={visible.length ? `kana-model-option-${activeIndex}` : undefined}
          tabIndex={-1}
          autoFocus
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {visible.map((row, index) => (
            <button
              key={row.key}
              id={`kana-model-option-${index}`}
              type="button"
              role="option"
              aria-selected={row.current}
              data-index={index}
              data-current={row.current ? "true" : undefined}
              disabled={Boolean(applying)}
              onPointerMove={() => setActive(index)}
              onClick={() => void apply(row)}
              className={`kana-focus flex w-full items-start gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${index === activeIndex ? "bg-surface-strong" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 text-[13px] font-extrabold leading-snug text-ink [overflow-wrap:anywhere]">
                    {row.model}
                  </span>
                  {row.isDefault ? (
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-extrabold text-accent-strong">
                      {copy.defaultModelBadge}
                    </span>
                  ) : null}
                </span>
                <span data-model-provider className="mt-0.5 block truncate text-[11px] font-bold text-muted">{row.providerName}</span>
              </span>
              {row.current ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent-strong" /> : null}
            </button>
          ))}
          {!visible.length ? (
            <p role="status" className="px-3 py-6 text-center text-[12px] font-bold text-muted">
              {query ? copy.modelSearchEmpty : copy.modelEmpty}
            </p>
          ) : null}
        </div>
      )}

      {applying ? (
        <p role="status" className="shrink-0 px-4 py-2 text-[11.5px] font-bold text-muted">{copy.modelSwitching}</p>
      ) : null}

      {confirmation ? (
        <div className="mx-2 mb-2 shrink-0 rounded-[18px] bg-surface-strong p-3">
          <p className="text-[11.5px] font-bold leading-relaxed text-ink-dim">{confirmation.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btnSecondary} min-h-9 px-3 text-[12px]`}
              onClick={() => setConfirmation(null)}
            >
              {copy.modelCancel}
            </button>
            <button
              type="button"
              className={`${btnPrimary} min-h-9 px-3 text-[12px]`}
              disabled={Boolean(applying)}
              onClick={confirmSwitch}
            >
              {copy.modelConfirmSwitch}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
