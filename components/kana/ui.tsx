// Shared UI primitives for the Kana presentation layer.

export const btnPrimary =
  "kana-focus kana-pill kana-pill-accent min-h-10 whitespace-nowrap px-5 text-[13px] disabled:cursor-not-allowed disabled:opacity-60";

export const btnSecondary =
  "kana-focus kana-pill kana-pill-soft min-h-10 px-5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold text-muted transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export const btnDangerGhost =
  "kana-focus inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40";

export const inputBase =
  "kana-focus min-h-10 w-full rounded-[20px] border-2 border-transparent bg-surface-strong px-4 py-2 text-[13px] font-medium text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none disabled:opacity-50";

export const bentoCard = "rounded-[28px] border-2 border-line bg-surface p-4";

export const chipBase =
  "kana-focus inline-flex min-h-9 items-center rounded-full border-2 px-3.5 text-xs font-bold transition-colors";

export const fieldLabel = "text-[11.5px] font-extrabold text-muted";

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
      className={`kana-focus relative h-8 w-14 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-surface-strong"
      }`}
    >
      <span className={`absolute top-1 size-6 rounded-full transition-[left,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        checked ? "left-7 bg-white" : "left-1 bg-muted"
      }`} />
    </button>
  );
}
