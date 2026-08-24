"use client";

/**
 * Debug indicator: a psychedelic animated rainbow border shown on the avatar
 * stage while Kana is fetching data from the server (chat history, session
 * list, activity logs). Purely visual — lets you SEE every server request
 * from the UI without opening devtools.
 */

type FetchIndicatorProps = {
  active: boolean;
};

export function FetchIndicator({ active }: FetchIndicatorProps) {
  if (!active) return null;
  return (
    <>
      <style>{`
        @keyframes kana-rainbow-spin {
          0% { filter: hue-rotate(0deg); }
          100% { filter: hue-rotate(360deg); }
        }
        @keyframes kana-rainbow-border {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .kana-rainbow-frame {
          background: linear-gradient(
            90deg,
            #ff004c, #ff8a00, #ffee00, #00ff66, #00cfff, #8a2be2, #ff004c
          );
          background-size: 200% 100%;
          animation:
            kana-rainbow-border 1.2s linear infinite,
            kana-rainbow-spin 3s linear infinite;
        }
      `}</style>
      {/* Full-screen frame around the viewport edges */}
      <div className="pointer-events-none fixed inset-0 z-50 p-1" aria-hidden="true">
        <div className="kana-rainbow-frame h-full w-full rounded-2xl opacity-90" />
        <div className="absolute inset-[10px] rounded-xl bg-transparent" />
      </div>
      <div
        className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wider text-white uppercase shadow-lg"
        style={{
          background:
            "linear-gradient(90deg, #ff004c, #ff8a00, #ffee00, #00ff66, #00cfff, #8a2be2)",
          backgroundSize: "200% 100%",
          animation: "kana-rainbow-border 1.2s linear infinite",
        }}
        role="status"
      >
        ⟳ Fetching from server…
      </div>
    </>
  );
}
