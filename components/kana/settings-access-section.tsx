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
import {
  settingsButton,
  settingsButtonDanger,
  SettingsGroup,
  settingsInput,
  SettingsRow,
  SettingsRows,
} from "./settings-layout";

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
    <SettingsRows>
      <SettingsRow label={copy.updatePassword} description={copy.passwordPolicy} stacked>
        <div className="grid max-w-md gap-2.5">
          <input type="password" autoComplete="current-password" className={settingsInput} placeholder={copy.currentPassword}
            aria-label={copy.currentPassword} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          <input type="password" autoComplete="new-password" className={settingsInput} placeholder={copy.newPassword}
            aria-label={copy.newPassword} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <input type="password" autoComplete="new-password" className={settingsInput} placeholder={copy.confirmPassword}
            aria-label={copy.confirmPassword} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          {error ? <p className="text-[11px] font-semibold text-danger" role="alert">{error}</p> : null}
          {success ? <p className="text-[11px] font-semibold text-accent-strong" role="status">{success}</p> : null}
          <div>
            <button type="button" className={settingsButton} disabled={busy || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submit()}>
              {busy ? copy.updating : copy.updatePassword}
            </button>
          </div>
        </div>
      </SettingsRow>
      <SettingsRow label={copy.logout} description={copy.logoutDescription}>
        <button type="button" className={settingsButtonDanger} onClick={() => void logoutAccessSession()}>
          {copy.logout}
        </button>
      </SettingsRow>
    </SettingsRows>
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
    <SettingsGroup title={copy.advancedTitle} description={copy.advancedBody}>
      <SettingsRows>
        <SettingsRow label="config.json" description={copy.advancedRestart} stacked>
          <code className="block overflow-x-auto rounded-lg border border-line bg-surface-strong/60 px-3 py-2 text-[11.5px] text-ink-dim">
            {configPath}
          </code>
          {configError ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-danger" role="alert">
              {copy.advancedConfigError} {configError}
            </p>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label={copy.advancedMode}
          description={deploymentModeSource === "environment"
            ? copy.advancedModeSourceEnvironment
            : deploymentModeSource === "config"
              ? copy.advancedModeSourceConfig
              : copy.advancedModeSourceDefault}
        >
          <span className="text-xs font-semibold text-ink-dim">
            {deploymentMode === "deployment" ? copy.advancedModeDeployment : copy.advancedModeLocal}
          </span>
        </SettingsRow>
      </SettingsRows>
    </SettingsGroup>
  );
}
