// Shared UI primitives for the Kana presentation layer.

export const btnPrimary =
  "kana-focus inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border-2 border-accent bg-accent px-4 text-xs font-bold text-on-accent transition-colors hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed";

export const btnSecondary =
  "kana-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-2 border-line-strong bg-surface px-4 text-xs font-semibold text-ink-dim transition-[border-color,background-color,color] hover:border-accent hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export const btnDangerGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40";

export const inputBase =
  "kana-focus min-h-10 w-full rounded-xl border-2 border-line-strong bg-surface-strong px-3 py-2 text-[13px] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-50";

export const bentoCard = "rounded-2xl border-2 border-line bg-surface p-4";

export const chipBase =
  "kana-focus inline-flex min-h-9 items-center rounded-xl border px-3 text-xs font-semibold transition-colors";

export const fieldLabel = "text-[11px] font-bold tracking-wide text-muted";

export const sectionEyebrow =
  "text-[10px] font-bold tracking-[0.16em] text-muted uppercase";

export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`kana-focus relative h-7 w-12 shrink-0 rounded-lg border-2 transition-colors ${
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-strong"
      }`}
    >
      <span className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-md transition-all ${
        checked ? "left-[25px] bg-on-accent" : "left-[3px] bg-muted"
      }`} />
    </button>
  );
}
