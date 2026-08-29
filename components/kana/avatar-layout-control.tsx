"use client";

import { useEffect, useRef } from "react";
import type { Live2DModelLayout } from "@/lib/avatar/model-layout";
import type { Copy } from "@/lib/ui/copy";
import { AvatarLayoutPanel } from "./avatar-layout-panel";
import { AvatarPositionIcon } from "./icons";

type AvatarLayoutControlProps = {
  layout: Live2DModelLayout;
  copy: Copy;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChange(layout: Live2DModelLayout): void;
  onReset(): void;
};

export function AvatarLayoutControl({
  layout,
  copy,
  open,
  onOpenChange,
  onChange,
  onReset,
}: AvatarLayoutControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="kana-workspace-action kana-focus"
        aria-controls="kana-avatar-layout-panel"
        aria-expanded={open}
        aria-label={copy.workspace.openAvatarLayout}
        onClick={() => onOpenChange(!open)}
      >
        <AvatarPositionIcon />
        <span className="max-sm:sr-only">{copy.workspace.avatar}</span>
      </button>

      {open ? (
        <div
          id="kana-avatar-layout-panel"
          className="fixed right-4 top-[76px] z-30 max-sm:right-3 max-sm:top-[64px]"
        >
          <AvatarLayoutPanel
            layout={layout}
            copy={copy.settings}
            onChange={onChange}
            onReset={onReset}
          />
        </div>
      ) : null}
    </div>
  );
}
