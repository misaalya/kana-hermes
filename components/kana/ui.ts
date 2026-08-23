// Shared Tailwind class presets for the Kana design system.
// Flat dual-tone: raised surfaces, 1px lines, pink accent, no gradients.

export const btnPrimary =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40";

export const btnSecondary =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-line-strong px-4 text-xs font-semibold text-ink-dim transition-colors hover:border-accent hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40";

export const btnGhost =
  "inline-flex items-center text-xs font-semibold text-muted transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40";

export const btnDangerGhost =
  "inline-flex items-center text-xs font-semibold text-muted transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-40";

export const inputBase =
  "min-h-9 w-full rounded-xl border border-line-strong bg-transparent px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:opacity-50";

export const iconButton =
  "grid size-8 place-items-center rounded-full border border-line bg-raised text-ink-dim transition-colors hover:border-accent hover:text-accent-strong";

export const bentoCard = "rounded-2xl border border-line bg-surface p-4";

export const chipBase =
  "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors";

export const fieldLabel = "text-[11px] font-semibold text-muted";
