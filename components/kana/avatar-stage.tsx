import type { AvatarSnapshot } from "@/lib/avatar/types";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  status: string;
  busy: boolean;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export function AvatarStage({ avatar, status, busy, onCanvasReady }: AvatarStageProps) {
  const isLive2D = avatar.renderMode === "live2d";

  return (
    <section className={`avatar-stage emotion-${avatar.emotion}`} aria-label="Kana avatar stage">
      <canvas
        className={`live2d-avatar-canvas${isLive2D ? " visible" : ""}`}
        ref={onCanvasReady}
        aria-hidden="true"
      />

      {!isLive2D ? (
        <div className="avatar-skeleton" aria-hidden="true">
          <div className="skeleton-circle"><span>?</span></div>
          <p>Waiting for Live2D avatar</p>
        </div>
      ) : null}

      <div className="stage-status" aria-live="polite">
        <span className={`pulse${busy ? " active" : ""}`} />
        {status}
      </div>
    </section>
  );
}