"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "@/components/kana/code-block";
import { btnPrimary, btnSecondary, inputBase, fieldLabel } from "@/components/kana/ui";
import { LocalPreferencesStore } from "@/lib/preferences/local-preferences-store";
import { fetchAuthStatus } from "@/lib/runtime/auth-client";
import { useTheme } from "@/lib/state/use-theme";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

/** Until a password exists the page looks again this often, and the form
 * appears on its own once the command has run. */
const SETUP_POLL_MS = 3_000;

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [locale, setLocale] = useState<UiLocale>("id");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null while unknown; the form stays usable so a slow status never blocks login.
  const [passwordConfigured, setPasswordConfigured] = useState<boolean | null>(null);
  // The one command for this install: `kana password`, or the checkout's or
  // standalone deployment's equivalent (from /api/auth/status).
  const [passwordCommand, setPasswordCommand] = useState("kana password");
  const [checking, setChecking] = useState(false);
  const copy = getCopy(locale).login;
  const nextTheme = theme === "dark" ? "light" : "dark";

  /** False when the server could not be reached; the last answer stays. */
  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setPasswordConfigured(status.passwordConfigured);
      if (status.passwordCommand) setPasswordCommand(status.passwordCommand);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    // Browser-only preference; read after hydration to avoid a mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(new LocalPreferencesStore().load().uiLocale);
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (passwordConfigured !== false) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshStatus();
    }, SETUP_POLL_MS);
    return () => clearInterval(timer);
  }, [passwordConfigured, refreshStatus]);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    setError(null);
    if (!(await refreshStatus())) setError(copy.unreachable);
    setChecking(false);
  }, [refreshStatus, copy]);

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
          if (data.code === "password_not_configured") void refreshStatus();
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
    [router, copy, refreshStatus],
  );

  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4 font-sans">
      <button type="button" className="kana-focus kana-pill kana-pill-soft absolute right-4 top-4 px-4 py-2.5 text-[12px]" onClick={toggleTheme} aria-label={copy.themeToggle(nextTheme)}>
        {copy.themeLabel(nextTheme)}
      </button>
      <div className="kana-panel relative w-[min(400px,100%)] p-7 sm:p-8">
        {/* No visible title: the card is just the password form. */}
        <h1 className="sr-only">Kana</h1>

        {passwordConfigured === false ? (
          <div className="grid gap-4" role="status">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-extrabold text-ink">{copy.setupTitle}</h2>
              <p className="text-[13px] leading-relaxed text-muted">{copy.setupBody}</p>
            </div>
            <CodeBlock label="Terminal" code={passwordCommand} copyLabel={copy.copy} copiedLabel={copy.copied} />
            {error ? (
              <p className="text-[11px] font-semibold text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className={btnSecondary} onClick={() => void checkAgain()} disabled={checking}>
              {checking ? copy.setupChecking : copy.setupRefresh}
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={submit}>
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
        )}
        <div className="mt-5 border-t border-line pt-4 text-[10px] text-faint">
          {copy.footer}
        </div>
      </div>
    </main>
  );
}
