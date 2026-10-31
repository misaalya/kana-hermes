"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useKanaStore } from "./kana-workspace-context";
import { useHostSnapshot, type HostReading } from "./use-host-snapshot";

const TICKS = 5;
/** Matches the dock's slide-out transition before the strip unmounts. */
const CLOSE_MS = 320;
/** A reading this recent is reused instead of fetched again on reopen. */
const CACHE_MS = 15_000;

/** Hours and minutes stack on two lines so the strip can stay narrow. */
function uptimeLines(seconds: number): [string, string] {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  if (days > 0) return [`${days}d`, `${hours}h`];
  if (hours > 0) return [`${hours}h`, `${minutes}m`];
  return [`${minutes}m`, `${whole % 60}s`];
}

function HostRow({
  label,
  value,
  secondary,
  percent,
  detail,
}: {
  label: string;
  value: string;
  secondary?: string;
  percent?: number | null;
  detail?: string;
}) {
  const filled = percent == null ? 0 : Math.round((percent / 100) * TICKS);
  return (
    <div className="flex justify-end py-2 text-right">
      <span className="flex flex-col items-end">
        <span className="text-[8px] font-extrabold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        <span className="mt-0.5 text-[15px] font-extrabold leading-none text-ink tabular-nums">
          {value}
        </span>
        {percent != null ? (
          <span
            aria-hidden="true"
            data-host-ticks=""
            className="mt-1 flex w-full flex-col-reverse gap-[2px] self-stretch"
          >
            {Array.from({ length: TICKS }, (_, index) => (
              <span
                key={index}
                className={`h-1.5 w-full rounded-[1px] transition-colors duration-500 ${
                  index < filled ? "bg-accent" : "bg-line"
                }`}
              />
            ))}
          </span>
        ) : null}
        {secondary ? (
          <span className="mt-0.5 text-[12px] font-extrabold leading-none text-ink-dim tabular-nums">
            {secondary}
          </span>
        ) : null}
        {detail ? (
          <p className="mt-0.5 text-[8px] font-bold leading-snug text-faint">{detail}</p>
        ) : null}
      </span>
    </div>
  );
}

function HostStrip({ locale, reading }: { locale: UiLocale; reading: HostReading }) {
  const settings = getCopy(locale).settings;
  const { snapshot, cpu, error } = reading;
  const memory = snapshot
    ? percentUsed(snapshot.memory.total, snapshot.memory.available)
    : null;
  const disk = snapshot?.disk
    ? percentUsed(snapshot.disk.total, snapshot.disk.available)
    : null;
  const [uptimeValue, uptimeSecondary] = uptimeLines(snapshot?.uptime ?? 0);

  return (
    <>
      <div className="px-3 pb-2 pt-3 text-right">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-muted">
          {settings.hostTitle}
        </p>
        {snapshot?.hostname ? (
          <p className="mt-0.5 truncate text-[9px] font-bold text-faint">{snapshot.hostname}</p>
        ) : null}
      </div>
      {snapshot ? (
        <div className="px-3 pb-3">
          <div className="divide-y-2 divide-dotted divide-line-strong">
            <HostRow
              label={settings.hostCpu}
              value={cpu === null ? "—" : `${Math.round(cpu)}%`}
              percent={cpu}
            />
            <HostRow
              label={settings.hostMemory}
              value={memory === null ? "—" : `${Math.round(memory)}%`}
              percent={memory}
            />
            <HostRow
              label={settings.hostDisk}
              value={disk === null ? "—" : `${Math.round(disk)}%`}
              percent={disk}
            />
            <HostRow
              label={settings.hostUptime}
              value={uptimeValue}
              secondary={uptimeSecondary}
              detail={snapshot.source === "remote"
                ? settings.hostHermesDetail(
                    formatDuration(snapshot.kana.uptime),
                    formatBytes(snapshot.kana.rss),
                  )
                : settings.hostKanaDetail(
                    formatDuration(snapshot.kana.uptime),
                    formatBytes(snapshot.kana.rss),
                  )}
            />
          </div>
          {error ? (
            <p className="pt-2 text-right text-[8.5px] font-bold text-danger">{settings.hostFailed}</p>
          ) : null}
        </div>
      ) : (
        <p
          className={`px-3 pb-4 pt-2 text-center text-[10px] font-bold ${
            error ? "text-danger" : "animate-kana-pulse text-muted"
          }`}
        >
          {error ? settings.hostFailed : settings.hostLoading}
        </p>
      )}
    </>
  );
}

/**
 * Phones tuck the host strip behind a right-edge tab, shaped like the chat
 * dock's handle. The last reading stays cached while the strip is closed, so
 * reopening it shows metrics at once; a fresh sample is reused instead of
 * asking the host again.
 */
export function MobileHostPanel() {
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const greeting = useKanaStore("workspace", (state) => state.greeting);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const text = getCopy(locale).workspace;
  const settings = getCopy(locale).settings;
  const active = open && usesMobileChat && !greeting && !avatarLayoutOpen;
  const reading = useHostSnapshot({ active, freshForMs: CACHE_MS });

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setMounted(false), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  if (!usesMobileChat || greeting || avatarLayoutOpen) return null;

  return (
    <div className={`kana-host-dock ${open ? "" : "is-closed"}`}>
      <button
        type="button"
        className="kana-host-toggle kana-focus absolute -left-10 top-1/2 z-20 h-24 w-10 -translate-y-1/2 text-accent hover:text-accent-hover"
        aria-controls="kana-host-panel"
        aria-expanded={open}
        aria-label={open ? text.hideHost : text.showHost}
        onClick={() => {
          setMounted(true);
          setOpen((value) => !value);
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 48 112"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M48 0H27C22 0 19 2 16 6L5 20C2 24 1 28 1 33V79C1 84 2 88 5 92L16 106C19 110 22 112 27 112H48Z"
            fill="currentColor"
          />
        </svg>
        <span className="relative z-10 grid h-full place-items-center text-on-accent">
          {open ? <ChevronRightIcon className="size-5" /> : <ChevronLeftIcon className="size-5" />}
        </span>
      </button>
      <section
        id="kana-host-panel"
        aria-label={settings.hostTitle}
        aria-hidden={!open}
        inert={open ? undefined : true}
        className="kana-host-panel"
      >
        {mounted ? <HostStrip locale={locale} reading={reading} /> : null}
      </section>
    </div>
  );
}
