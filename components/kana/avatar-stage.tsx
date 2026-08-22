import type { AvatarSnapshot } from "@/lib/avatar/types";
import type { KanaMessage } from "@/lib/conversation/types";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  latestAssistant?: KanaMessage;
  status: string;
  busy: boolean;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export function AvatarStage({
  avatar,
  latestAssistant,
  status,
  busy,
  onCanvasReady,
}: AvatarStageProps) {
  return (
    <section className={`avatar-stage emotion-${avatar.emotion}`} aria-label="Kana avatar stage">
      <div className="stage-atmosphere" aria-hidden="true" />

      <canvas
        className={
          avatar.renderMode === "live2d"
            ? "live2d-avatar-canvas visible"
            : "live2d-avatar-canvas"
        }
        ref={onCanvasReady}
        aria-hidden="true"
      />

      <div
        className={`avatar-figure ${avatar.talking ? "is-talking" : ""} ${
          avatar.renderMode === "live2d" ? "hidden" : ""
        }`}
        aria-hidden="true"
      >
        <div className="avatar-hair-back" />
        <div className="avatar-neck" />
        <div className="avatar-body">
          <div className="avatar-collar" />
        </div>
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
          <span
            className="avatar-mouth"
            style={{ transform: `translateX(-50%) scaleY(${0.2 + avatar.mouthOpen})` }}
          />
        </div>
        <div className="avatar-hair-side hair-left" />
        <div className="avatar-hair-side hair-right" />
      </div>

      <div className="stage-status" aria-live="polite">
        <span className={busy ? "status-pulse active" : "status-pulse"} />
        {status}
      </div>

      <div className="latest-dialogue">
        <div className="speaker-name">
          <span>Kana</span>
          {latestAssistant?.subtitle ? (
            <small>{latestAssistant.subtitle.language.toUpperCase()}</small>
          ) : null}
        </div>
        <p>
          {latestAssistant?.subtitle?.text ||
            "I’m ready. Say something whenever you like."}
        </p>
        {latestAssistant?.speech_ja ? (
          <small className="dialogue-japanese" lang="ja">
            {latestAssistant.speech_ja}
          </small>
        ) : null}
      </div>
    </section>
  );
}
