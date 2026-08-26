"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, inputBase, fieldLabel, sectionEyebrow } from "@/components/kana/ui";
import { useTheme } from "@/lib/state/use-theme";

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const password = inputRef.current?.value.trim();
      if (!password) return;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setError(data.error ?? "Login failed.");
        } else {
          router.push("/");
        }
      } catch {
        setError("Could not reach the login server.");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  return (
    <main className="kana-stage-pattern relative grid min-h-dvh place-items-center overflow-hidden bg-bg p-4 font-sans">
      <button type="button" className="kana-focus absolute right-4 top-4 border border-line bg-raised px-3 py-2 text-[11px] font-semibold text-muted hover:text-ink" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <div className="kana-panel relative w-[min(390px,100%)] rounded-2xl p-6 sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <p className={sectionEyebrow}>Welcome back</p>
            <h1 className="text-lg font-bold tracking-wide text-ink">Kana</h1>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">Enter your local password to return to your companion.</p>

          <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Password</span>
              <input
                ref={inputRef}
                type="password"
                autoFocus
                autoComplete="current-password"
                disabled={loading}
                placeholder="Enter your password"
                className={inputBase}
              />
            </label>

            {error ? (
              <p className="text-[11px] font-semibold text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <button className={btnPrimary} type="submit" disabled={loading}>
              {loading ? "Entering…" : "Enter Kana"}
            </button>
          </form>
          <div className="mt-5 border-t border-line pt-4 text-[10px] text-faint">
            Your password stays on this Kana installation.
          </div>
        </div>
    </main>
  );
}
