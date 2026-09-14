// Flat settings layout: page title, titled groups, and divided rows with the
// label on the left and the control on the right. No boxed cards or header
// bands; hierarchy comes from typography, spacing, and hairline dividers.

export const settingsButton =
  "kana-focus inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-raised px-3 text-xs font-semibold text-ink-dim transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

export const settingsButtonDanger =
  `${settingsButton} hover:border-danger/60 hover:text-danger`;

export const settingsInput =
  "kana-focus min-h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-[13px] text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none disabled:opacity-50";

export function SettingsPageTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-base font-bold text-ink max-md:hidden">{children}</h2>;
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="pt-8 first:pt-0">
      {title ? <h3 className="text-[15px] font-bold text-ink">{title}</h3> : null}
      {description ? (
        <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {children ? <div className={title || description ? "mt-2" : ""}>{children}</div> : null}
    </section>
  );
}

/** A divided row. `stacked` puts the control under the label (wide controls). */
export function SettingsRow({
  label,
  description,
  children,
  stacked = false,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={`py-3.5 ${
        stacked ? "" : "flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</div>
        ) : null}
      </div>
      {children ? (
        <div className={stacked ? "mt-3" : "flex shrink-0 items-center gap-2 max-sm:flex-wrap"}>{children}</div>
      ) : null}
    </div>
  );
}

/** Rows without an outer box, separated by hairlines (wrapped rows count too). */
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-line">{children}</div>;
}

export function SettingsSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface-strong/60 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`kana-focus min-h-7 rounded-md px-3 text-xs font-semibold transition-colors ${
              active ? "kana-segment-active bg-raised text-ink" : "text-muted hover:text-ink"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small status pill with a dot, for runtime states. */
/** `capitalize` suits raw runtime states ("running"); pass false for sentences. */
export function StatusPill({ tone, children, capitalize = true }: { tone: "ok" | "busy" | "error" | "idle"; children: React.ReactNode; capitalize?: boolean }) {
  const toneClass = {
    ok: "text-accent-strong",
    busy: "text-accent-strong animate-kana-pulse",
    error: "text-danger",
    idle: "text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${capitalize ? "capitalize" : ""} ${toneClass}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}
