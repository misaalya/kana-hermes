import {
  isDefaultLive2DModelLayout,
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "@/lib/avatar/model-layout";
import type { Copy } from "@/lib/ui/copy";
import { CloseIcon, MinusIcon, PlusIcon, ResetIcon } from "./icons";

type AvatarLayoutPanelProps = {
  layout: Live2DModelLayout;
  copy: Copy["settings"];
  onChange(layout: Live2DModelLayout): void;
  onReset(): void;
  onClose(): void;
};

const iconButton =
  "kana-focus grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-35";

function LayoutSlider({
  label,
  value,
  minimum,
  maximum,
  display,
  children,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  display: string;
  children?: React.ReactNode;
  onChange(value: number): void;
}) {
  const fill = ((value - minimum) / (maximum - minimum)) * 100;
  return (
    <div className="py-2">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="text-[13px] text-ink">{label}</span>
        <span className="flex items-center gap-1">
          {children}
          <output aria-hidden="true" className="min-w-12 text-right text-xs tabular-nums text-muted">
            {display}
          </output>
        </span>
      </div>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={1}
        value={Math.round(value)}
        aria-label={label}
        aria-valuetext={display}
        className="kana-range kana-focus mt-1.5 w-full"
        style={{ "--kana-range-fill": `${fill}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

export function AvatarLayoutPanel({
  layout,
  copy,
  onChange,
  onReset,
  onClose,
}: AvatarLayoutPanelProps) {
  const normalized = normalizeLive2DModelLayout(layout);
  const automatic = isDefaultLive2DModelLayout(normalized);
  const update = (patch: Partial<Live2DModelLayout>) => {
    onChange(normalizeLive2DModelLayout({ ...normalized, ...patch }));
  };
  const offset = (fraction: number) => {
    const percent = Math.round(fraction * 100);
    return percent === 0 ? copy.avatarLayoutCenter : `${percent > 0 ? "+" : ""}${percent}%`;
  };
  const size = Math.round(normalized.scale * 100);

  return (
    <section
      className="kana-popover w-[min(300px,calc(100vw-1.5rem))] rounded-xl border border-line-strong bg-raised px-4 pb-3 pt-3 animate-kana-in max-sm:w-full"
      aria-label={copy.avatarLayoutAria}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold text-ink">{copy.avatarLayoutTitle}</h2>
        <div className="-mr-1.5 flex items-center">
          <button type="button" className={iconButton} disabled={automatic} onClick={onReset} aria-label={copy.avatarLayoutReset} title={copy.avatarLayoutReset}>
            <ResetIcon className="size-3.5" />
          </button>
          <button type="button" className={iconButton} onClick={onClose} aria-label={copy.avatarLayoutClose}>
            <CloseIcon className="size-4" />
          </button>
        </div>
      </header>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{copy.avatarLayoutHint}</p>

      <div className="mt-2 divide-y divide-line">
        <LayoutSlider
          label={copy.avatarLayoutScale}
          value={size}
          minimum={25}
          maximum={250}
          display={`${size}%`}
          onChange={(value) => update({ scale: value / 100 })}
        >
          <button type="button" className={iconButton} aria-label={copy.avatarLayoutSmaller} disabled={size <= 25} onClick={() => update({ scale: (size - 10) / 100 })}>
            <MinusIcon className="size-3.5" />
          </button>
          <button type="button" className={iconButton} aria-label={copy.avatarLayoutLarger} disabled={size >= 250} onClick={() => update({ scale: (size + 10) / 100 })}>
            <PlusIcon className="size-3.5" />
          </button>
        </LayoutSlider>
        <LayoutSlider
          label={copy.avatarLayoutHorizontal}
          value={normalized.x * 100}
          minimum={-75}
          maximum={75}
          display={offset(normalized.x)}
          onChange={(value) => update({ x: value / 100 })}
        />
        <LayoutSlider
          label={copy.avatarLayoutVertical}
          value={normalized.y * 100}
          minimum={-75}
          maximum={75}
          display={offset(normalized.y)}
          onChange={(value) => update({ y: value / 100 })}
        />
      </div>
    </section>
  );
}
