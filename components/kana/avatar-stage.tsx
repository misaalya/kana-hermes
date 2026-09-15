import { memo } from "react";
import type { AvatarSnapshot } from "@/lib/avatar/types";
import type { StageBackground } from "@/lib/preferences/types";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  background: StageBackground;
  customBackgroundUrl?: string;
  chatOpen: boolean;
  /** Phones show the avatar as a small call-style tile beside a full-screen chat. */
  compact?: boolean;
  locale: UiLocale;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export const AvatarStage = memo(function AvatarStage({
  avatar,
  background,
  customBackgroundUrl,
  chatOpen,
  compact = false,
  locale,
  onCanvasReady,
}: AvatarStageProps) {
  const isLive2D = avatar.renderMode === "live2d";
  const copy = getCopy(locale).avatarStage;

  return (
    <section
      className={`kana-stage-pattern absolute inset-0 overflow-hidden ${compact ? "is-compact" : ""}`}
      data-background={background}
      aria-label={copy.label}
    >
      <div
        className="kana-stage-backdrop absolute inset-0"
        style={background === "custom" && customBackgroundUrl
          ? { backgroundImage: `url("${customBackgroundUrl}")` }
          : undefined}
        aria-hidden="true"
      />
      <div
        className="kana-avatar-viewport absolute inset-0 overflow-hidden"
        data-chat-open={chatOpen}
      >
        <div className="kana-avatar-content absolute inset-0">
          <canvas
            className={`pointer-events-none absolute inset-0 z-[4] h-full w-full transition-opacity duration-500 ${isLive2D ? "opacity-100" : "opacity-0"}`}
            ref={onCanvasReady}
            aria-hidden="true"
            data-testid="live2d-canvas"
          />

          {!isLive2D ? (
            avatar.loadError ? (
              <div className="kana-stage-message absolute inset-0 z-[2] flex items-center justify-center px-6 text-center" role="status">
                <div className="max-w-sm">
                  <p className="text-sm font-bold text-ink">{copy.loadFailed}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{avatar.loadError}</p>
                  <p className="mt-2 text-[11px] text-faint">{copy.loadFailedHint}</p>
                </div>
              </div>
            ) : (
              <div className="kana-stage-message absolute inset-0 z-[2] flex flex-col items-center justify-center text-center" aria-hidden="true">
                <div>
                  <p className="text-sm font-bold text-ink-dim">{copy.preparing}</p>
                  <p className="mt-1 text-[11px] text-muted">{copy.waitingForLive2D}</p>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
});
