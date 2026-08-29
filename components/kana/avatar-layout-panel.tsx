import {
  isDefaultLive2DModelLayout,
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "@/lib/avatar/model-layout";
import type { Copy } from "@/lib/ui/copy";
import { btnGhost } from "./ui";

type AvatarLayoutPanelProps = {
  layout: Live2DModelLayout;
  copy: Copy["settings"];
  onChange(layout: Live2DModelLayout): void;
  onReset(): void;
};

type LayoutControlProps = {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  suffix: string;
  onChange(value: number): void;
};

function LayoutControl({
  label,
  value,
  minimum,
  maximum,
  suffix,
  onChange,
}: LayoutControlProps) {
  return (
    <label className="grid gap-2 rounded-xl border-2 border-line bg-surface-strong px-3 py-3">
      <span className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold text-ink-dim">{label}</span>
        <output
          aria-hidden="true"
          className="min-w-12 text-right text-[10px] font-bold text-accent"
        >
          {Math.round(value)}{suffix}
        </output>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={`${Math.round(value)}${suffix}`}
        className="kana-focus h-6 w-full cursor-pointer accent-[var(--accent)]"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function AvatarLayoutPanel({
  layout,
  copy,
  onChange,
  onReset,
}: AvatarLayoutPanelProps) {
  const normalized = normalizeLive2DModelLayout(layout);
  const automatic = isDefaultLive2DModelLayout(normalized);
  const update = (patch: Partial<Live2DModelLayout>) => {
    onChange(normalizeLive2DModelLayout({ ...normalized, ...patch }));
  };

  return (
    <section
      className="w-[min(340px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border-2 border-line-strong bg-raised animate-kana-in"
      aria-label={copy.avatarLayoutAria}
    >
      <header className="flex items-center justify-between gap-4 border-b-2 border-line px-4 py-3">
        <h2 className="text-sm font-bold text-ink">{copy.avatarLayoutTitle}</h2>
        <span className="shrink-0 text-[10px] font-bold text-accent">
          {automatic ? copy.avatarLayoutAutomatic : copy.avatarLayoutAdjusted}
        </span>
      </header>

      <div className="grid gap-2 p-3">
        <LayoutControl
          label={copy.avatarLayoutHorizontal}
          value={normalized.x * 100}
          minimum={-75}
          maximum={75}
          suffix="%"
          onChange={(value) => update({ x: value / 100 })}
        />
        <LayoutControl
          label={copy.avatarLayoutVertical}
          value={normalized.y * 100}
          minimum={-75}
          maximum={75}
          suffix="%"
          onChange={(value) => update({ y: value / 100 })}
        />
        <LayoutControl
          label={copy.avatarLayoutScale}
          value={normalized.scale * 100}
          minimum={25}
          maximum={250}
          suffix="%"
          onChange={(value) => update({ scale: value / 100 })}
        />
      </div>

      <footer className="flex justify-end border-t-2 border-line px-3 py-2">
        <button
          type="button"
          className={btnGhost}
          disabled={automatic}
          onClick={onReset}
        >
          {copy.avatarLayoutReset}
        </button>
      </footer>
    </section>
  );
}
