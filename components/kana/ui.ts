// Shared UI primitives for the Kana presentation layer.

export const btnPrimary =
  "kana-focus inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-accent px-4 text-xs font-bold text-on-accent transition-[background-color,opacity] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40";

export const btnSecondary =
  "kana-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-xs font-semibold text-ink-dim transition-[border-color,background-color,color] hover:border-accent/55 hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export const btnGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export const btnDangerGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40";

export const inputBase =
  "kana-focus min-h-10 w-full rounded-xl border border-line-strong bg-surface-strong px-3 py-2 text-[13px] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent/70 focus:outline-none disabled:opacity-50";

export const bentoCard = "rounded-2xl border border-line bg-surface p-4";

export const chipBase =
  "kana-focus inline-flex min-h-9 items-center rounded-xl border px-3 text-xs font-semibold transition-colors";

export const fieldLabel = "text-[11px] font-bold tracking-wide text-muted";

export const sectionEyebrow =
  "text-[10px] font-bold tracking-[0.16em] text-muted uppercase";
