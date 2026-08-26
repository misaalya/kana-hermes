import { memo } from "react";
import type { AvatarSnapshot } from "@/lib/avatar/types";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export const AvatarStage = memo(function AvatarStage({
  avatar,
  onCanvasReady,
}: AvatarStageProps) {
  const isLive2D = avatar.renderMode === "live2d";

  return (
    <section
      className="kana-stage-pattern absolute inset-y-0 left-0 right-[min(35vw,510px)] overflow-hidden max-lg:right-0"
      aria-label="Kana avatar stage"
    >
      <canvas
        className={`pointer-events-none absolute inset-0 z-[4] h-full w-full transition-opacity duration-500 ${isLive2D ? "opacity-100" : "opacity-0"}`}
        ref={onCanvasReady}
        aria-hidden="true"
        data-testid="live2d-canvas"
      />

      {!isLive2D ? (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center text-center" aria-hidden="true">
          <div>
            <p className="text-sm font-bold text-ink-dim">Kana is getting ready</p>
            <p className="mt-1 text-[11px] text-muted">Waiting for Live2D avatar</p>
          </div>
        </div>
      ) : null}
    </section>
  );
});
