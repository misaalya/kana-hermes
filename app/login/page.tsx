"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, inputBase, fieldLabel } from "@/components/kana/ui";

export default function LoginPage() {
  const router = useRouter();
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
    <main className="grid min-h-dvh place-items-center bg-bg p-4 font-sans">
      <div className="w-[min(360px,100%)] rounded-3xl border border-line bg-bg p-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h1 className="text-lg font-bold tracking-wide text-ink">Kana</h1>
          <p className="mt-0.5 text-xs text-muted">Hermes, with a face and a voice</p>

          <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
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
        </div>
      </div>
    </main>
  );
}
