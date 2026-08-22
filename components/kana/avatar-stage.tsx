"use client";

import type { AvatarSnapshot } from "@/lib/avatar/types";
import { KANA_DEVELOPMENT_MODE } from "@/lib/config/features";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  status: string;
  busy: boolean;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export function AvatarStage({ avatar, status, busy, onCanvasReady }: AvatarStageProps) {
  const showMockFigure = avatar.renderMode === "mock" && KANA_DEVELOPMENT_MODE;

  return (
    <section className={`avatar-stage emotion-${avatar.emotion}`} aria-label="Kana avatar stage">
      <canvas
        className={`live2d-avatar-canvas${avatar.renderMode === "live2d" ? " visible" : ""}`}
        ref={onCanvasReady}
        aria-hidden="true"
      />

      {showMockFigure ? (
        <div className={`avatar-figure${avatar.talking ? " is-talking" : ""}`} aria-hidden="true">
          <div className="avatar-hair-back" />
          <div className="avatar-neck" />
          <div className="avatar-body"><div className="avatar-collar" /></div>
          <div className="avatar-face">
            <div className="avatar-fringe fringe-left" />
            <div className="avatar-fringe fringe-right" />
            <span className="avatar-brow brow-left" />
            <span className="avatar-brow brow-right" />
            <span className="avatar-eye eye-left" />
            <span className="avatar-eye eye-right" />
            <span className="avatar-highlight highlight-left" />
            <span className="avatar-highlight highlight-right" />
            <span className="avatar-blush blush-left" />
            <span className="avatar-blush blush-right" />
            <span className="avatar-nose" />
            <span className="avatar-mouth" style={{ transform: `translateX(-50%) scaleY(${0.2 + avatar.mouthOpen})` }} />
          </div>
          <div className="avatar-hair-side hair-left" />
          <div className="avatar-hair-side hair-right" />
        </div>
      ) : avatar.renderMode === "mock" && !KANA_DEVELOPMENT_MODE ? (
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