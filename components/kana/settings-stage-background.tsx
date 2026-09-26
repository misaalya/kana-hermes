"use client";

import { useEffect, useState } from "react";
import type {
  StageBackgroundAsset,
  StageBackgroundSummary,
} from "@/lib/background/indexed-db-stage-background-store";
import type { StageBackground } from "@/lib/preferences/types";
import type { Copy } from "@/lib/ui/copy";
import { CheckIcon, CloseIcon } from "./icons";

// Stage-background choices shown in Settings → Avatar.

export const STAGE_BACKGROUND_OPTIONS: Array<{
  value: StageBackground;
  previewClass: string;
}> = [
  { value: "plain", previewClass: "kana-background-preview-plain" },
  { value: "room", previewClass: "kana-background-preview-room" },
  { value: "pattern-sakura", previewClass: "kana-background-preview-pattern kana-pattern-sakura" },
  { value: "pattern-sparkle", previewClass: "kana-background-preview-pattern kana-pattern-sparkle" },
  { value: "pattern-clouds", previewClass: "kana-background-preview-pattern kana-pattern-clouds" },
  { value: "pattern-seigaiha", previewClass: "kana-background-preview-pattern kana-pattern-seigaiha" },
  { value: "pattern-ribbon", previewClass: "kana-background-preview-pattern kana-pattern-ribbon" },
];

export function StageBackgroundChoice({
  active,
  label,
  onRemove,
  onSelect,
  previewClass,
  previewUrl,
  copy,
}: {
  active: boolean;
  label: string;
  onRemove?: () => void;
  onSelect(): void;
  previewClass?: string;
  previewUrl?: string;
  copy: Copy["settings"];
}) {
  return (
    <div className={`kana-choice kana-wardrobe-card rounded-[26px] ${active ? "is-selected" : ""}`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={label}
        className="kana-focus flex w-full flex-col gap-2 rounded-[23px] p-2 pb-2.5 text-left"
        onClick={onSelect}
      >
        <span
          className={`kana-background-swatch block aspect-[16/10] w-full ${previewClass ?? "bg-bg"}`}
          style={previewUrl ? {
            backgroundImage: `url("${previewUrl}")`,
            backgroundPosition: "center",
            backgroundSize: "cover",
          } : undefined}
        />
        <span className="block truncate px-1 text-center text-[12.5px] font-extrabold text-ink">{label}</span>
      </button>
      {active ? <span className="kana-check" aria-hidden="true"><CheckIcon className="size-3.5" /></span> : null}
      {onRemove ? (
        <button
          type="button"
          className="kana-focus absolute left-3.5 top-3.5 z-[2] grid size-7 place-items-center rounded-full bg-raised text-muted transition-colors hover:text-danger"
          aria-label={copy.removeLabel(label)}
          onClick={onRemove}
        >
          <CloseIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function StoredStageBackgroundChoice({
  active,
  background,
  onLoad,
  onRemove,
  onSelect,
  copy,
}: {
  active: boolean;
  background: StageBackgroundSummary;
  onLoad(id: string): Promise<StageBackgroundAsset | null>;
  onRemove(): void;
  onSelect(): void;
  copy: Copy["settings"];
}) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    let activeLoad = true;
    let objectUrl: string | undefined;
    void onLoad(background.id).then((asset) => {
      if (!activeLoad || !asset) return;
      objectUrl = URL.createObjectURL(asset.content);
      setPreviewUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      activeLoad = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [background.id, onLoad]);

  return (
    <StageBackgroundChoice
      active={active}
      label={background.name}
      previewUrl={previewUrl}
      onSelect={onSelect}
      onRemove={onRemove}
      copy={copy}
    />
  );
}
