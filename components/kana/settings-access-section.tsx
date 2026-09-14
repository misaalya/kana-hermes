"use client";

import { useEffect, useState } from "react";
import {
  changeAccessPassword,
  fetchAuthStatus,
  logoutAccessSession,
  type AuthStatus,
} from "@/lib/runtime/auth-client";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { passwordPolicyError } from "@/shared/password-policy.mjs";
import { btnDangerGhost, btnSecondary, fieldLabel, inputBase } from "./ui";

// Settings → System/Privacy: access password, logout, and the server config
// location and validity.

export function SecuritySection({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => {
        if (active) {
          setStatus({
            authEnabled: true,
            authenticated: false,
            passwordConfigured: true,
            deploymentMode: "local",
          });
        }
      });
    return () => { active = false; };
  }, []);

  if (!status) return <p className="text-[11px] text-muted">{copy.checkingAccess}</p>;

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (passwordPolicyError(newPassword)) {
      setError(copy.passwordPolicy);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await changeAccessPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(copy.passwordUpdated);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : copy.passwordFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className={fieldLabel}>{copy.currentPassword}</span>
        <input type="password" autoComplete="current-password" className={inputBase}
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={fieldLabel}>{copy.newPassword}</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className={fieldLabel}>{copy.confirmPassword}</span>
          <input type="password" autoComplete="new-password" className={inputBase}
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      </div>
      {error ? <p className="text-[11px] font-semibold text-danger" role="alert">{error}</p> : null}
      {success ? <p className="text-[11px] font-semibold text-accent-strong" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={busy || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submit()}>
          {busy ? copy.updating : copy.updatePassword}
        </button>
        <button type="button" className={btnDangerGhost} onClick={() => void logoutAccessSession()}>
          {copy.logout}
        </button>
      </div>
    </div>
  );
}

export function AdvancedConfigCard({ locale }: { locale: UiLocale }) {
  const copy = getCopy(locale).settings;
  const [configPath, setConfigPath] = useState("$KANA_DATA_DIR/config.json");
  const [deploymentMode, setDeploymentMode] = useState<"local" | "deployment">("local");
  const [deploymentModeSource, setDeploymentModeSource] = useState<
    "environment" | "config" | "default"
  >("default");
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/kana/config", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value: {
        path?: string;
        deploymentMode?: "local" | "deployment";
        deploymentModeSource?: "environment" | "config" | "default";
        configError?: string | null;
      } | null) => {
        if (active) setConfigError(value?.configError ?? null);
        if (active && value?.path) setConfigPath(value.path);
        if (active && value?.deploymentMode) setDeploymentMode(value.deploymentMode);
        if (active && value?.deploymentModeSource) {
          setDeploymentModeSource(value.deploymentModeSource);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <details className="rounded-2xl border border-line bg-surface">
      <summary className="kana-details-summary kana-focus cursor-pointer px-4 py-4 text-xs font-bold text-ink">
        {copy.advancedTitle}
        <span className="ml-2 font-normal text-muted">{copy.advancedSuffix}</span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        <p className="text-[11px] leading-relaxed text-muted">
          {copy.advancedBody}
        </p>
        <code className="mt-3 block overflow-x-auto rounded-xl border border-line bg-surface-strong px-3 py-2.5 text-[11px] text-accent-strong">
          {configPath}
        </code>
        {configError ? (
          <p className="mt-3 text-[11px] leading-relaxed text-danger" role="alert">
            {copy.advancedConfigError} {configError}
          </p>
        ) : null}
        <p className="mt-3 text-[10px] font-bold text-ink">{copy.advancedMode}</p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          {deploymentMode === "deployment"
            ? copy.advancedModeDeployment
            : copy.advancedModeLocal}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-faint">
          {deploymentModeSource === "environment"
            ? copy.advancedModeSourceEnvironment
            : deploymentModeSource === "config"
              ? copy.advancedModeSourceConfig
              : copy.advancedModeSourceDefault}
        </p>
        <p className="mt-2 text-[10px] text-faint">{copy.advancedRestart}</p>
      </div>
    </details>
  );
}
