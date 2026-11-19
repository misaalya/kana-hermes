"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "@/components/kana/code-block";
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
  MoonIcon,
  ShieldIcon,
  SunIcon,
} from "@/components/kana/icons";
import { btnSecondary, fieldLabel } from "@/components/kana/ui";
import { LocalPreferencesStore } from "@/lib/preferences/local-preferences-store";
import { fetchAuthStatus } from "@/lib/runtime/auth-client";
import { useTheme } from "@/lib/state/use-theme";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

/** Until a password exists the page looks again this often, and the form
 * appears on its own once the command has run. */
const SETUP_POLL_MS = 3_000;
/** Remaining attempts are drawn as pips only once they are few. */
const MAX_PIPS = 5;

type LoginProblem =
  | { kind: "invalid"; remaining: number | null }
  | { kind: "locked"; until: number; total: number }
  | { kind: "changed" }
  | { kind: "unreachable" }
  | { kind: "message"; text: string };

type LoginResponse = {
  error?: string;
  code?: string;
  remainingBeforeLock?: unknown;
  retryAfter?: unknown;
};

/** Reads the login route's answer into what the page shows. */
function problemFrom(status: number, body: LoginResponse, fallback: string): LoginProblem {
  if (status === 429) {
    const seconds = typeof body.retryAfter === "number" && body.retryAfter > 0 ? body.retryAfter : 30;
    return { kind: "locked", until: Date.now() + seconds * 1000, total: seconds };
  }
  if (status === 401) {
    return typeof body.remainingBeforeLock === "number"
      ? { kind: "invalid", remaining: body.remainingBeforeLock }
      : { kind: "changed" };
  }
  return { kind: "message", text: body.error || fallback };
}

function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Kana's sea along the bottom of the page: three flowing crests. */
function LoginScene() {
  return (
    <>
      <div className="kana-login-backdrop" aria-hidden="true" />
      <div className="kana-login-sea" aria-hidden="true">
        <span className="kana-login-sea-layer kana-login-sea-layer--back" />
        <span className="kana-login-sea-layer kana-login-sea-layer--mid" />
        <span className="kana-login-sea-layer kana-login-sea-layer--front" />
      </div>
    </>
  );
}

function ProblemNote({
  problem,
  now,
  copy,
}: {
  problem: LoginProblem;
  now: number;
  copy: ReturnType<typeof getCopy>["login"];
}) {
  if (problem.kind === "locked") {
    const left = Math.max(0, (problem.until - now) / 1000);
    return (
      <div className="kana-login-note kana-login-note--locked" role="alert">
        <span className="kana-login-note-icon"><LockIcon className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="kana-login-note-title">{copy.lockedTitle}</p>
          <p className="kana-login-note-body">{copy.lockedBody}</p>
          <p className="kana-login-countdown" aria-hidden="true">{copy.lockedCountdown(formatCountdown(left))}</p>
          <span className="kana-login-countdown-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (left / problem.total) * 100)}%` }} />
          </span>
        </div>
      </div>
    );
  }
  if (problem.kind === "changed") {
    return (
      <div className="kana-login-note kana-login-note--info" role="alert">
        <span className="kana-login-note-icon"><KeyIcon className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="kana-login-note-title">{copy.changedTitle}</p>
          <p className="kana-login-note-body">{copy.changedBody}</p>
        </div>
      </div>
    );
  }
  const title =
    problem.kind === "invalid" ? copy.invalidTitle : problem.kind === "unreachable" ? copy.unreachable : copy.failed;
  const body =
    problem.kind === "invalid"
      ? problem.remaining !== null && problem.remaining > 0 ? copy.invalidRemaining(problem.remaining) : null
      : problem.kind === "unreachable" ? copy.unreachableHint : problem.text;
  return (
    <div className="kana-login-note kana-login-note--danger" role="alert">
      <span className="kana-login-note-icon"><AlertIcon className="size-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <p className="kana-login-note-title">{title}</p>
        {body ? <p className="kana-login-note-body">{body}</p> : null}
        {problem.kind === "invalid" && problem.remaining !== null && problem.remaining > 0 && problem.remaining <= MAX_PIPS ? (
          <span className="kana-login-pips" aria-hidden="true">
            {Array.from({ length: MAX_PIPS }, (_, index) => (
              <span key={index} className={index < problem.remaining! ? "is-left" : ""} />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [locale, setLocale] = useState<UiLocale>("id");
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "submitting" | "success">("idle");
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // null while unknown; the form stays usable so a slow status never blocks login.
  const [passwordConfigured, setPasswordConfigured] = useState<boolean | null>(null);
  // The one command for this install: `kana password`, or the checkout's or
  // standalone deployment's equivalent (from /api/auth/status).
  const [passwordCommand, setPasswordCommand] = useState("kana password");
  const [checking, setChecking] = useState(false);
  const copy = getCopy(locale).login;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const locked = problem?.kind === "locked" && problem.until > now;
  const busy = phase !== "idle";

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

  // The lockout counts down on screen and lifts itself when it ends.
  useEffect(() => {
    if (problem?.kind !== "locked") return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= problem.until) {
        setProblem(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, 250);
    return () => clearInterval(timer);
  }, [problem]);

  const shake = useCallback(() => {
    const node = cardRef.current;
    if (!node || typeof node.animate !== "function") return;
    const distance = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 3 : 9;
    node.animate(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(-${distance}px)` },
        { transform: `translateX(${distance - 1}px)` },
        { transform: `translateX(-${distance - 3}px)` },
        { transform: `translateX(${distance - 5}px)` },
        { transform: "translateX(0)" },
      ],
      { duration: 420, easing: "ease-in-out" },
    );
  }, []);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    setSetupError(null);
    if (!(await refreshStatus())) setSetupError(copy.unreachable);
    setChecking(false);
  }, [refreshStatus, copy]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const password = inputRef.current?.value.trim();
      if (!password || busy || locked) return;

      setPhase("submitting");
      setProblem(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (res.ok) {
          setPhase("success");
          router.push("/");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as LoginResponse;
        if (data.code === "password_not_configured") void refreshStatus();
        const next = problemFrom(res.status, data, copy.failed);
        setNow(Date.now());
        setProblem(next);
        if (next.kind === "invalid") {
          shake();
          inputRef.current?.select();
        }
      } catch {
        setProblem({ kind: "unreachable" });
      }
      setPhase("idle");
    },
    [busy, locked, router, copy, refreshStatus, shake],
  );

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"));
  };

  return (
    <main className="kana-login font-sans">
      <LoginScene />

      <div className="kana-login-top">
        <button
          type="button"
          className="kana-focus kana-pill kana-pill-soft kana-login-theme"
          onClick={toggleTheme}
          aria-label={copy.themeToggle(nextTheme)}
          title={copy.themeLabel(nextTheme)}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      <div className="kana-login-stage">
        <section ref={cardRef} className="kana-login-card">
          <h1 className="sr-only">Kana</h1>

          {passwordConfigured === false ? (
            <div className="grid gap-5" role="status">
              <h2 className="kana-login-title text-center">{copy.setupTitle}</h2>
              <ol className="kana-login-steps">
                <li>
                  <span className="kana-login-step-number" aria-hidden="true">1</span>
                  <p>{copy.setupStepTerminal}</p>
                </li>
                <li>
                  <span className="kana-login-step-number" aria-hidden="true">2</span>
                  <div className="grid min-w-0 flex-1 gap-2.5">
                    <p>{copy.setupStepRun}</p>
                    <CodeBlock label="Terminal" code={passwordCommand} copyLabel={copy.copy} copiedLabel={copy.copied} />
                  </div>
                </li>
                <li>
                  <span className="kana-login-step-number" aria-hidden="true">3</span>
                  <div className="grid min-w-0 flex-1 gap-2">
                    <p>{copy.setupStepWait}</p>
                    <span className="kana-login-waiting">
                      <span className="kana-login-waiting-dot" aria-hidden="true" />
                      {copy.setupWaiting}
                    </span>
                  </div>
                </li>
              </ol>
              {setupError ? (
                <div className="kana-login-note kana-login-note--danger" role="alert">
                  <span className="kana-login-note-icon"><AlertIcon className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="kana-login-note-title">{setupError}</p>
                    <p className="kana-login-note-body">{copy.unreachableHint}</p>
                  </div>
                </div>
              ) : null}
              <button type="button" className={`${btnSecondary} w-full`} onClick={() => void checkAgain()} disabled={checking}>
                {checking ? copy.setupChecking : copy.setupRefresh}
              </button>
              <p className="kana-login-footnote">
                <ShieldIcon className="size-4 shrink-0 text-accent" />
                {copy.setupNoDefault}
              </p>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={submit} noValidate>
              <div className="grid gap-1.5">
                <label htmlFor="kana-login-password" className={fieldLabel}>{copy.password}</label>
                <div className="kana-login-field">
                  <LockIcon className="kana-login-field-icon" />
                  <input
                    id="kana-login-password"
                    ref={inputRef}
                    type={reveal ? "text" : "password"}
                    autoFocus
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy || locked}
                    placeholder={copy.placeholder}
                    aria-invalid={problem?.kind === "invalid" ? true : undefined}
                    onKeyDown={onKey}
                    onKeyUp={onKey}
                    onInput={() => {
                      if (problem?.kind === "invalid" || problem?.kind === "changed") setProblem(null);
                    }}
                    className="kana-field kana-login-input"
                  />
                  <button
                    type="button"
                    className="kana-focus kana-login-reveal"
                    onClick={() => {
                      setReveal((value) => !value);
                      inputRef.current?.focus();
                    }}
                    aria-label={reveal ? copy.hidePassword : copy.showPassword}
                    aria-pressed={reveal}
                    disabled={busy || locked}
                  >
                    {reveal ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
                  </button>
                </div>
                {capsLock && !locked ? (
                  <span className="kana-login-caps" role="status">
                    <AlertIcon className="size-3.5" />
                    {copy.capsLock}
                  </span>
                ) : null}
              </div>

              {problem && (problem.kind !== "locked" || locked) ? (
                <ProblemNote problem={problem} now={now} copy={copy} />
              ) : null}

              <button
                className={`kana-focus kana-pill kana-pill-accent kana-login-submit ${phase === "success" ? "is-success" : ""}`}
                type="submit"
                disabled={busy || locked}
              >
                {phase === "submitting" ? (
                  <>
                    <span className="kana-login-spinner" aria-hidden="true" />
                    {copy.submitting}
                  </>
                ) : phase === "success" ? (
                  <>
                    <CheckIcon className="size-[18px]" />
                    {copy.signedIn}
                  </>
                ) : (
                  <>
                    {copy.submit}
                    <ChevronRightIcon className="size-[18px]" />
                  </>
                )}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
