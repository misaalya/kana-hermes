import { memo } from "react";
import type { AvatarSnapshot } from "@/lib/avatar/types";
import type { StageBackground } from "@/lib/preferences/types";
import type { UiLocale } from "@/lib/ui/copy";

type AvatarStageProps = {
  avatar: AvatarSnapshot;
  background: StageBackground;
  customBackgroundUrl?: string;
  chatOpen: boolean;
  locale: UiLocale;
  onCanvasReady(canvas: HTMLCanvasElement | null): void;
};

export const AvatarStage = memo(function AvatarStage({
  avatar,
  background,
  customBackgroundUrl,
  chatOpen,
  locale,
  onCanvasReady,
}: AvatarStageProps) {
  const isLive2D = avatar.renderMode === "live2d";

  return (
    <section
      className="kana-stage-pattern absolute inset-0 overflow-hidden"
      data-background={background}
      aria-label={locale === "id" ? "Panggung avatar Kana" : "Kana avatar stage"}
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
            <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center text-center" aria-hidden="true">
              <div>
                <p className="text-sm font-bold text-ink-dim">{locale === "id" ? "Kana sedang bersiap" : "Kana is getting ready"}</p>
                <p className="mt-1 text-[11px] text-muted">{locale === "id" ? "Menunggu avatar Live2D" : "Waiting for Live2D avatar"}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});
