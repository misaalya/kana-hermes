"use client";

import { useEffect, useState } from "react";
import type {
  StageBackgroundAsset,
  StageBackgroundSummary,
} from "@/lib/background/indexed-db-stage-background-store";
import type { StageBackground } from "@/lib/preferences/types";
import type { Copy } from "@/lib/ui/copy";
import { CloseIcon } from "./icons";

// Stage-background choices shown in Settings → Avatar.

export const STAGE_BACKGROUND_OPTIONS: Array<{
  value: StageBackground;
  previewClass: string;
}> = [
  { value: "plain", previewClass: "kana-background-preview-plain" },
  { value: "room", previewClass: "kana-background-preview-room" },
  { value: "pattern-sparkles", previewClass: "kana-background-preview-pattern-sparkles" },
  { value: "pattern-twinkle", previewClass: "kana-background-preview-pattern-twinkle" },
  { value: "pattern-gingham", previewClass: "kana-background-preview-pattern-gingham" },
  { value: "pattern-stars", previewClass: "kana-background-preview-pattern-stars" },
  { value: "pattern-swirls", previewClass: "kana-background-preview-pattern-swirls" },
];

export function StageBackgroundChoice({
  active,
  hint,
  label,
  onRemove,
  onSelect,
  previewClass,
  previewUrl,
  copy,
}: {
  active: boolean;
  hint: string;
  label: string;
  onRemove?: () => void;
  onSelect(): void;
  previewClass?: string;
  previewUrl?: string;
  copy: Copy["settings"];
}) {
  return (
    <div className={`relative min-w-0 shrink-0 basis-full snap-start overflow-hidden rounded-2xl border-2 transition-colors sm:basis-[calc((100%_-_1.5rem)/3)] ${
      active ? "border-accent bg-surface-strong" : "border-line bg-raised hover:border-line-strong"
    }`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`${label}. ${hint}`}
        className="kana-focus block w-full text-left"
        onClick={onSelect}
      >
        <span
          className={`block aspect-[16/9] border-b-2 border-line ${previewClass ?? "bg-bg"}`}
          style={previewUrl ? {
            backgroundImage: `url("${previewUrl}")`,
            backgroundPosition: "center",
            backgroundSize: "cover",
          } : undefined}
        />
        <span className="flex items-center justify-between gap-2 px-3 py-3">
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-ink">{label}</span>
            <span className="mt-0.5 block truncate text-[9px] text-muted">{hint}</span>
          </span>
          <span className={`shrink-0 text-[10px] font-bold ${active ? "text-accent" : "text-faint"}`}>
            {active ? copy.selected : copy.choose}
          </span>
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="kana-focus absolute top-2 right-2 flex size-8 items-center justify-center rounded-xl border-2 border-line-strong bg-raised/95 text-muted transition-colors hover:border-danger hover:text-danger"
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
      hint={copy.localBackground}
      previewUrl={previewUrl}
      onSelect={onSelect}
      onRemove={onRemove}
      copy={copy}
    />
  );
}
