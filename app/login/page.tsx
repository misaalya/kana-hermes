"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnGhost, btnPrimary, inputBase, fieldLabel, sectionEyebrow } from "@/components/kana/ui";
import { LocalPreferencesStore } from "@/lib/preferences/local-preferences-store";
import { fetchAuthStatus } from "@/lib/runtime/auth-client";
import { useTheme } from "@/lib/state/use-theme";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

const SETUP_COMMAND = "kana password";

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [locale, setLocale] = useState<UiLocale>("id");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null while unknown; the form stays usable so a slow status never blocks login.
  const [passwordConfigured, setPasswordConfigured] = useState<boolean | null>(null);
  const copy = getCopy(locale).login;
  const nextTheme = theme === "dark" ? "light" : "dark";

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setPasswordConfigured(status.passwordConfigured);
    } catch {
      setPasswordConfigured(null);
    }
  }, []);

  useEffect(() => {
    // Browser-only preference; read after hydration to avoid a mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(new LocalPreferencesStore().load().uiLocale);
    void refreshStatus();
  }, [refreshStatus]);

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
          const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          if (data.code === "password_not_configured") setPasswordConfigured(false);
          setError(data.error ?? copy.failed);
        } else {
          router.push("/");
        }
      } catch {
        setError(copy.unreachable);
      } finally {
        setLoading(false);
      }
    },
    [router, copy],
  );

  return (
    <main className="kana-stage-pattern relative grid min-h-dvh place-items-center overflow-hidden bg-bg p-4 font-sans">
      <button type="button" className="kana-focus absolute right-4 top-4 border border-line bg-raised px-3 py-2 text-[11px] font-semibold text-muted hover:text-ink" onClick={toggleTheme} aria-label={copy.themeToggle(nextTheme)}>
        {copy.themeLabel(nextTheme)}
      </button>
      <div className="kana-panel relative w-[min(390px,100%)] rounded-2xl p-6 sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <p className={sectionEyebrow}>{copy.eyebrow}</p>
            <h1 className="text-lg font-bold tracking-wide text-ink">Kana</h1>
          </div>
        </div>

        {passwordConfigured === false ? (
          <div className="grid gap-3" role="status">
            <p className="text-xs font-bold text-ink">{copy.setupTitle}</p>
            <p className="text-xs leading-relaxed text-muted">{copy.setupBody}</p>
            <code className="block rounded-xl border border-line bg-surface-strong px-3 py-2.5 text-sm font-bold text-ink">
              {SETUP_COMMAND}
            </code>
            <p className="text-[11px] leading-relaxed text-faint">{copy.setupSource}</p>
            <button type="button" className={btnGhost} onClick={() => void refreshStatus()}>
              {copy.setupRefresh}
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted">{copy.body}</p>
            <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>{copy.password}</span>
                <input
                  ref={inputRef}
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  disabled={loading}
                  placeholder={copy.placeholder}
                  className={inputBase}
                />
              </label>

              {error ? (
                <p className="text-[11px] font-semibold text-danger" role="alert">
                  {error}
                </p>
              ) : null}

              <button className={btnPrimary} type="submit" disabled={loading}>
                {loading ? copy.submitting : copy.submit}
              </button>
            </form>
          </>
        )}
        <div className="mt-5 border-t border-line pt-4 text-[10px] text-faint">
          {copy.footer}
        </div>
      </div>
    </main>
  );
}
