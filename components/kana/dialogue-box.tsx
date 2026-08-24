import { memo } from "react";
import type { KanaMessage } from "@/lib/conversation/types";

type DialogueBoxProps = {
  message: KanaMessage | undefined;
};

/**
 * The Kana dialogue box: the live speech bubble floating above the composer
 * while Kana talks. Shows the latest assistant turn's subtitle (and its
 * Japanese speech as a secondary line when it differs in content), so a
 * response is readable without opening the message-history modal.
 *
 * Memoized: re-renders only when the displayed message identity changes, not
 * on every composer keystroke or activity-pill update.
 */
export const DialogueBox = memo(function DialogueBox({ message }: DialogueBoxProps) {
  if (!message || message.role !== "assistant") return null;

  const subtitle = message.subtitle?.text?.trim();
  if (!subtitle) return null;

  return (
    <div
      className="pointer-events-auto relative max-w-full rounded-3xl rounded-bl-lg border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-label="Kana's reply"
    >
      <span className="mb-0.5 flex items-center gap-1.5">
        <strong className="text-[10px] font-bold tracking-wider text-accent-strong uppercase">Kana</strong>
        {message.emotion ? (
          <span className="rounded-full border border-line px-1.5 py-px text-[8px] font-bold tracking-wider text-muted uppercase">
            {message.emotion}
          </span>
        ) : null}
      </span>
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{subtitle}</p>
    </div>
  );
});
