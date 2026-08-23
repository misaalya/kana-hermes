import { memo } from "react";
import type { AvatarSnapshot } from "@/lib/avatar/types";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  busy: boolean;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

/**
 * Memoized: the stage hosts the WebGL canvas, so re-rendering it on every
 * keystroke (draft state lives in KanaApp) would reconcile React against the
 * animating canvas subtree for no benefit.
 */
export const AvatarStage = memo(function AvatarStage({ avatar, busy, onCanvasReady }: AvatarStageProps) {
  const isLive2D = avatar.renderMode === "live2d";

  return (
    <section className="absolute inset-0 overflow-hidden bg-bg" aria-label="Kana avatar stage">
      {/* Flat concentric rings behind the avatar */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line max-md:size-[280px]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line max-md:size-[380px]" />

      <canvas
        className={`pointer-events-none absolute inset-0 z-[4] h-full w-full transition-opacity duration-200 ${isLive2D ? "opacity-100" : "opacity-0"}`}
        ref={onCanvasReady}
        aria-hidden="true"
      />

      {!isLive2D ? (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 text-faint" aria-hidden="true">
          <div className="grid size-28 place-items-center rounded-full border-2 border-dashed border-line-strong bg-surface">
            <span className="text-4xl opacity-40">?</span>
          </div>
          <p className="text-[11px]">Waiting for Live2D avatar</p>
        </div>
      ) : null}

      <div className="absolute left-3 top-3 z-10" aria-live="polite">
        <span
          className={`inline-block size-2 rounded-full ${busy ? "bg-accent animate-kana-pulse" : "bg-muted/60"}`}
          title={busy ? "Kana is working" : "Idle"}
        />
      </div>
    </section>
  );
});
