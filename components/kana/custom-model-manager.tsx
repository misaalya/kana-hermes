"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AddHermesModelInput, HermesCustomProvider } from "@/lib/runtime/hermes-models-client";
import type { AddHermesModelResult, ModelChangeRestart } from "@/lib/services/model-change-restart";
import { getCopy } from "@/lib/ui/copy";
import { btnPrimary, btnSecondary, fieldLabel } from "./ui";
import { settingsInput } from "./settings-layout";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, PlusIcon, SaveIcon } from "./icons";

type SettingsCopy = ReturnType<typeof getCopy>["settings"];
type ProviderView =
  | { kind: "list" }
  | { kind: "provider"; providerId: string }
  | { kind: "create" }
  | { kind: "edit"; providerId: string }
  | { kind: "addModel"; providerId: string };

const BACK_BUTTON = "kana-focus kana-pill kana-pill-soft size-9 shrink-0 justify-center";
const ROW =
  "kana-focus group flex w-full items-center justify-between gap-3 py-3 text-left";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className={`${fieldLabel} block`}>{label}</span>
      {children}
      {hint ? <span className="block text-[11px] leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** The saved change is already in Hermes; this says whether it is live yet. */
function restartNote(copy: SettingsCopy, outcome: ModelChangeRestart): string {
  switch (outcome.status) {
    case "restarted":
      return copy.modelRestartDone;
    case "reconnecting":
      return copy.modelRestartReconnecting;
    case "busy":
      return copy.modelRestartBusy;
    case "not-managed":
      return copy.modelRestartNotManaged;
    case "remote":
      return copy.modelRestartRemote;
    case "not-running":
      return copy.modelRestartNotRunning;
    case "failed":
      return copy.modelRestartFailed(outcome.message);
  }
}

function ModelsHeader({ copy, count }: { copy: SettingsCopy; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[11.5px] font-extrabold text-muted">{copy.modelProviderModels}</p>
      <span className="text-[11px] font-medium tabular-nums text-faint">{count}</span>
    </div>
  );
}

function NewProviderForm({
  copy,
  onSubmit,
  onSaved,
  onCancel,
}: {
  copy: SettingsCopy;
  onSubmit(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onSaved(result: AddHermesModelResult): Promise<void>;
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [contextLength, setContextLength] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      setError(copy.modelProviderRequired);
      return;
    }
    const context = contextLength.trim() === "" ? undefined : Number(contextLength);
    if (context !== undefined && (!Number.isInteger(context) || context < 1)) {
      setError(copy.modelAddContextInvalid);
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(context !== undefined ? { contextLength: context } : {}),
      });
      setApiKey("");
      await onSaved(result);
    } catch (cause) {
      setError(errorText(cause, copy.modelProviderFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="max-w-[520px] space-y-4" onSubmit={(event) => void submit(event)} aria-label={copy.modelProviderNewTitle}>
      <div className="space-y-4">
        <div className="space-y-3">
          <p className="text-[11px] font-extrabold text-muted">{copy.modelProviderConnectionSection}</p>
          <Field label={copy.modelAddName}>
          <input
            className={settingsInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddBaseUrl} hint={copy.modelAddBaseUrlHint}>
          <input
            className={settingsInput}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            maxLength={2048}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddApiKey} hint={copy.modelProviderApiKeyHint}>
          <input
            className={settingsInput}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            maxLength={16_384}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-extrabold text-muted">{copy.modelProviderFirstModelSection}</p>
        <Field label={copy.modelProviderFirstModel}>
          <input
            className={settingsInput}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            required
            maxLength={200}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddContextLength} hint={copy.modelAddContextHint}>
          <input
            className={settingsInput}
            type="number"
            min={1}
            max={10_000_000}
            step={1}
            value={contextLength}
            onChange={(event) => setContextLength(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        </div>
      </div>
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? copy.modelAddSaving : copy.modelProviderCreate}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {copy.modelAddCancel}
        </button>
      </div>
    </form>
  );
}

function EditProviderForm({
  copy,
  provider,
  onSubmit,
  onSaved,
  onCancel,
}: {
  copy: SettingsCopy;
  provider: HermesCustomProvider;
  onSubmit(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onSaved(result: AddHermesModelResult): Promise<void>;
  onCancel(): void;
}) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider.models[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsModel = provider.models.length === 0;
  const keyNeeded = provider.source === "direct-config" && provider.hasApiKey;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      setError(copy.modelProviderRequired);
      return;
    }
    if (keyNeeded && !apiKey.trim()) {
      setError(copy.modelAddDirectConfigRequired);
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit({
        providerId: provider.id,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      await onSaved(result);
    } catch (cause) {
      setError(errorText(cause, copy.modelProviderFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="max-w-[520px] space-y-4" onSubmit={(event) => void submit(event)} aria-label={copy.modelProviderEditTitle}>
      <div className="space-y-3">
        <Field label={copy.modelAddName}>
          <input
            className={settingsInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddBaseUrl} hint={copy.modelAddBaseUrlHint}>
          <input
            className={settingsInput}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            maxLength={2048}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddApiKey} hint={copy.modelAddApiKeyHint}>
          <input
            className={settingsInput}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            required={keyNeeded}
            maxLength={16_384}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        {needsModel ? (
          <Field label={copy.modelProviderFirstModel}>
            <input
              className={settingsInput}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              maxLength={200}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
          </Field>
        ) : null}
      </div>
      {provider.models.length ? (
        <div className="space-y-2">
          <ModelsHeader copy={copy} count={provider.models.length} />
          <ul className="space-y-1.5">
            {provider.models.map((model) => (
              <li
                key={model}
                className="break-all rounded-full bg-surface-strong px-3.5 py-1.5 text-[12px] font-medium text-ink-dim"
              >
                {model}
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted">{copy.modelProviderModelsEditHint}</p>
        </div>
      ) : null}
      {keyNeeded ? <p className="text-[11px] leading-relaxed text-muted">{copy.modelAddDirectConfigHint}</p> : null}
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? copy.modelAddSaving : copy.modelProviderSave}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {copy.modelAddCancel}
        </button>
      </div>
    </form>
  );
}

function AddModelForm({
  copy,
  provider,
  onSubmit,
  onSaved,
  onCancel,
}: {
  copy: SettingsCopy;
  provider: HermesCustomProvider;
  onSubmit(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onSaved(result: AddHermesModelResult): Promise<void>;
  onCancel(): void;
}) {
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [contextLength, setContextLength] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyNeeded = provider.source === "direct-config" && provider.hasApiKey;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!model.trim()) {
      setError(copy.modelAddRequired);
      return;
    }
    if (keyNeeded && !apiKey.trim()) {
      setError(copy.modelAddDirectConfigRequired);
      return;
    }
    const context = contextLength.trim() === "" ? undefined : Number(contextLength);
    if (context !== undefined && (!Number.isInteger(context) || context < 1)) {
      setError(copy.modelAddContextInvalid);
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit({
        providerId: provider.id,
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(context !== undefined ? { contextLength: context } : {}),
      });
      setApiKey("");
      await onSaved(result);
    } catch (cause) {
      setError(errorText(cause, copy.modelAddFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="max-w-[520px] space-y-4" onSubmit={(event) => void submit(event)} aria-label={copy.modelAddTitle}>
      <div className="space-y-3">
        <Field label={copy.modelAddModelId}>
          <input
            className={settingsInput}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            required
            maxLength={200}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        <Field label={copy.modelAddContextLength} hint={copy.modelAddContextHint}>
          <input
            className={settingsInput}
            type="number"
            min={1}
            max={10_000_000}
            step={1}
            value={contextLength}
            onChange={(event) => setContextLength(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        {keyNeeded ? (
          <Field label={copy.modelAddApiKey} hint={copy.modelAddDirectConfigHint}>
            <input
              className={settingsInput}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
              maxLength={16_384}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </Field>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? copy.modelAddSaving : copy.modelAddSubmit}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {copy.modelAddCancel}
        </button>
      </div>
    </form>
  );
}

function ModelIdRow({
  copy,
  provider,
  model,
  onSubmit,
  onAdded,
}: {
  copy: SettingsCopy;
  provider: HermesCustomProvider;
  model: string;
  onSubmit(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onAdded(result: AddHermesModelResult): Promise<void>;
}) {
  const [value, setValue] = useState(model);
  const [confirming, setConfirming] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = value.trim();
  const changed = next !== "" && next !== model;
  const keyNeeded = provider.source === "direct-config" && provider.hasApiKey;

  const cancel = () => {
    setConfirming(false);
    setApiKey("");
    setError("");
    setValue(model);
  };

  const save = async () => {
    if (!changed || busy) return;
    if (keyNeeded && !apiKey.trim()) {
      setError(copy.modelAddDirectConfigRequired);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit({
        providerId: provider.id,
        model: next,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      setConfirming(false);
      setValue(model);
      await onAdded(result);
    } catch (cause) {
      setError(errorText(cause, copy.modelAddFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <input
          className={`${settingsInput} min-h-9 py-1 text-[12px]`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
            if (confirming && event.target.value.trim() === model) setConfirming(false);
          }}
          aria-label={`${copy.modelAddModelId}: ${model}`}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
        />
        {changed ? (
          <button
            type="button"
            className="kana-focus grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`${copy.modelProviderSaveModel}: ${model}`}
            title={copy.modelProviderSaveModel}
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            <SaveIcon className="size-4" />
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-start gap-2 rounded-[20px] border-2 border-[#ca2a30] bg-[#ca2a30] px-3.5 py-2 text-xs font-semibold text-white">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{copy.modelAddExistingWarning}</p>
          </div>
          {keyNeeded ? (
            <input
              className={settingsInput}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={copy.modelAddApiKey}
              aria-label={`${copy.modelAddApiKey}: ${model}`}
              maxLength={16_384}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          ) : null}
          {error ? <p role="alert" className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${btnPrimary} min-h-8 px-3 text-[11px]`}
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? copy.modelAddSaving : copy.modelProviderAddAsNew}
            </button>
            <button
              type="button"
              className={`${btnSecondary} min-h-8 px-3 text-[11px]`}
              onClick={cancel}
              disabled={busy}
            >
              {copy.modelAddCancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CustomModelManager({
  copy,
  onListProviders,
  onSubmit,
  onCatalogChanged,
}: {
  copy: SettingsCopy;
  onListProviders(): Promise<HermesCustomProvider[]>;
  onSubmit(input: AddHermesModelInput): Promise<AddHermesModelResult>;
  onCatalogChanged(): void | Promise<void>;
}) {
  const [providers, setProviders] = useState<HermesCustomProvider[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"muted" | "danger">("muted");
  const [view, setView] = useState<ProviderView>({ kind: "list" });

  useEffect(() => {
    let live = true;
    void onListProviders()
      .then((list) => { if (live) setProviders(list); })
      .catch((cause) => {
        if (!live) return;
        setProviders([]);
        setLoadError(errorText(cause, copy.modelAddProvidersFailed));
      });
    return () => { live = false; };
    // The section mounts once; the callbacks stay stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshProviders = async () => {
    try {
      setProviders(await onListProviders());
      setLoadError("");
    } catch (cause) {
      setLoadError(errorText(cause, copy.modelAddProvidersFailed));
    }
  };

  const go = (next: ProviderView) => {
    setStatus("");
    setStatusTone("muted");
    setView(next);
  };

  const handleSaved = async (result: AddHermesModelResult, next: ProviderView) => {
    setStatus(`${copy.modelAddSuccess} ${restartNote(copy, result.restart)}`);
    setStatusTone(result.restart.status === "failed" ? "danger" : "muted");
    await refreshProviders();
    setView(next);
    try {
      await onCatalogChanged();
    } catch {
      // Hermes saved the change; a stale picker is recoverable with Refresh.
    }
  };

  const provider = (view.kind === "provider" || view.kind === "addModel" || view.kind === "edit")
    ? providers?.find((item) => item.id === view.providerId) ?? null
    : null;
  const effectiveView: ProviderView = (view.kind === "provider" || view.kind === "addModel" || view.kind === "edit") && !provider
    ? { kind: "list" }
    : view;

  const title = effectiveView.kind === "list"
    ? copy.sections.providers.label
    : effectiveView.kind === "provider"
      ? provider!.name
      : effectiveView.kind === "create"
        ? copy.modelProviderNewTitle
        : effectiveView.kind === "edit"
          ? copy.modelProviderEditTitle
          : copy.modelAddTitle;
  const description = effectiveView.kind === "list"
    ? copy.modelManagerDescription
    : effectiveView.kind === "provider"
      ? provider!.baseUrl
      : effectiveView.kind === "create"
        ? copy.modelProviderNewDescription
        : effectiveView.kind === "edit"
          ? copy.modelProviderEditDescription
          : copy.modelAddDescription;
  const backTarget: ProviderView | null = effectiveView.kind === "list"
    ? null
    : effectiveView.kind === "provider"
      ? { kind: "list" }
      : effectiveView.kind === "create"
        ? { kind: "list" }
        : { kind: "provider", providerId: effectiveView.providerId };

  const keyLabel = (item: HermesCustomProvider) =>
    item.hasApiKey ? copy.modelProviderKeySaved : copy.modelProviderNoKey;

  return (
    <section className="@container space-y-4" aria-label={copy.sections.providers.label}>
      <header className="flex items-start gap-2">
        {backTarget ? (
          <button
            type="button"
            className={BACK_BUTTON}
            aria-label={copy.modelManagerBack}
            onClick={() => go(backTarget)}
          >
            <ChevronLeftIcon className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words text-base font-extrabold text-ink">{title}</h3>
            {effectiveView.kind === "provider" ? (
              <button
                type="button"
                className="kana-focus inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-accent-strong transition-colors hover:text-accent"
                onClick={() => go({ kind: "edit", providerId: provider!.id })}
              >
                <EditIcon className="size-3.5" />
                {copy.modelProviderEdit}
              </button>
            ) : null}
          </div>
          <p className={`mt-0.5 text-[11.5px] leading-relaxed text-muted ${effectiveView.kind === "provider" ? "break-all" : "break-words"}`}>
            {description}
          </p>
        </div>
      </header>

      {status ? (
        <p
          role="status"
          className={`text-[11px] leading-relaxed ${statusTone === "danger" ? "text-danger" : "text-muted"}`}
        >
          {status}
        </p>
      ) : null}

      {providers === null ? (
        <p className="text-[11px] text-muted">{copy.modelLoading}</p>
      ) : (
        <>
          {loadError ? <p role="status" className="text-[11px] leading-relaxed text-muted">{loadError}</p> : null}

          {effectiveView.kind === "list" ? (
            <div>
              {providers.length ? (
                <div className="divide-y divide-line">
                  {providers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={ROW}
                      aria-label={`${item.name}, ${copy.modelProviderModelCount(item.models.length)}, ${keyLabel(item)}`}
                      onClick={() => go({ kind: "provider", providerId: item.id })}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="break-words text-[13px] font-bold text-ink transition-colors group-hover:text-accent-strong">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted">
                          {copy.modelProviderModelCount(item.models.length)} · {keyLabel(item)}
                          {item.source === "direct-config" ? ` · ${copy.modelProviderDirect}` : ""}
                        </span>
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent-strong" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted">{copy.modelProviderEmpty}</p>
              )}
              <button
                type="button"
                className="kana-focus mt-2 flex w-full items-center gap-1.5 rounded-full px-2 py-2 text-left text-[12px] font-bold text-accent-strong transition-colors hover:text-accent"
                onClick={() => go({ kind: "create" })}
              >
                <PlusIcon className="size-4" />
                {copy.modelProviderAdd}
              </button>
            </div>
          ) : null}

          {effectiveView.kind === "provider" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  {keyLabel(provider!)}
                </span>
                {provider!.source === "direct-config" ? (
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-accent" />
                    {copy.modelProviderDirect}
                  </span>
                ) : null}
              </div>

              <div className="space-y-2">
                <ModelsHeader copy={copy} count={provider!.models.length} />
                {provider!.models.length ? (
                  <div className="divide-y divide-line">
                    {provider!.models.map((model) => (
                      <ModelIdRow
                        key={model}
                        copy={copy}
                        provider={provider!}
                        model={model}
                        onSubmit={onSubmit}
                        onAdded={(result) => handleSaved(result, { kind: "provider", providerId: provider!.id })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted">{copy.modelProviderNoModels}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => go({ kind: "addModel", providerId: provider!.id })}
                >
                  <PlusIcon className="size-4" />
                  {copy.modelProviderAddModel}
                </button>
              </div>
            </div>
          ) : null}

          {effectiveView.kind === "addModel" && provider ? (
            <AddModelForm
              copy={copy}
              provider={provider}
              onSubmit={onSubmit}
              onSaved={(result) => handleSaved(result, { kind: "provider", providerId: provider.id })}
              onCancel={() => go({ kind: "provider", providerId: provider.id })}
            />
          ) : null}

          {effectiveView.kind === "edit" && provider ? (
            <EditProviderForm
              copy={copy}
              provider={provider}
              onSubmit={onSubmit}
              onSaved={(result) => handleSaved(result, { kind: "provider", providerId: provider.id })}
              onCancel={() => go({ kind: "provider", providerId: provider.id })}
            />
          ) : null}

          {effectiveView.kind === "create" ? (
            <NewProviderForm
              copy={copy}
              onSubmit={onSubmit}
              onSaved={(result) => handleSaved(result, { kind: "list" })}
              onCancel={() => go({ kind: "list" })}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
