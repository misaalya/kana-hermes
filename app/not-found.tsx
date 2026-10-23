"use client";

import { useTheme } from "@/lib/state/use-theme";

export default function NotFound() {
  useTheme();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="kana-not-found-code-x">
          <div className="kana-not-found-code-y">
            <div className="kana-not-found-code-r">
              <p className="text-[64px] font-extrabold leading-none text-accent">404</p>
            </div>
          </div>
        </div>
        <div className="kana-not-found-caption-x">
          <div className="kana-not-found-caption-y">
            <div className="kana-not-found-caption-r">
              <p className="text-[18px] font-extrabold tracking-[0.12em] text-muted">
                Not Found
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
