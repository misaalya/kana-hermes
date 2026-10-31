"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useKanaStore } from "./kana-workspace-context";
import { useHostSnapshot, type HostReading } from "./use-host-snapshot";

const TICKS = 10;
/** Matches the dock's slide-out transition before the strip unmounts. */
const CLOSE_MS = 320;
/** A reading this recent is reused instead of fetched again on reopen. */
const CACHE_MS = 15_000;

/** Hours and minutes stack on two lines so the rail can stay slim. */
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
    <div className="flex flex-1 shrink-0 flex-col justify-center py-3">
      <p className="text-[8px] font-extrabold uppercase leading-[1.2] tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-1.5 text-[19px] font-extrabold leading-[0.95] text-ink tabular-nums">
        {value}
        {secondary ? (
          <span className="block">{secondary}</span>
        ) : null}
      </p>
      {percent != null ? (
        <span
          data-host-meter=""
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="mt-2 flex h-[60px] flex-col-reverse gap-[2px]"
        >
          {Array.from({ length: TICKS }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={`min-h-[2px] flex-1 rounded-[2px] transition-colors duration-500 ${
                index < filled ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </span>
      ) : detail ? (
        <p className="mt-2 text-[8px] font-bold leading-[1.45] text-faint">{detail}</p>
      ) : null}
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
    <div className="flex min-h-full flex-col px-3 pb-2">
      <div className="flex flex-1 flex-col divide-y divide-dotted divide-line-strong">
        <div className="shrink-0 pb-2.5 pt-3">
          <p className="text-[8px] font-extrabold uppercase leading-[1.2] tracking-[0.1em] text-muted">
            {settings.hostTitle}
          </p>
          {snapshot?.hostname ? (
            <p
              className="mt-1 truncate text-[9.5px] font-extrabold leading-none text-ink-dim"
              title={snapshot.hostname}
            >
              {snapshot.hostname}
            </p>
          ) : null}
        </div>
        {snapshot ? (
          <>
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
          </>
        ) : (
          <p
            className={`flex flex-1 items-center px-1 pb-2 text-[9.5px] font-bold leading-snug ${
              error ? "text-danger" : "animate-kana-pulse text-muted"
            }`}
          >
            {error ? settings.hostFailed : settings.hostLoading}
          </p>
        )}
      </div>
      {error && snapshot ? (
        <p className="pt-1.5 text-[8px] font-bold leading-snug text-danger">
          {settings.hostFailed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Phones tuck the host rail behind a right-edge tab, shaped like the chat
 * dock's handle. The rail runs from the header down to the composer, and each
 * metric owns an equal slice of it so the gauge column reads top to bottom.
 * The last reading stays cached while the rail is closed, so reopening it
 * shows metrics at once; a fresh sample is reused instead of asking the host
 * again.
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
        className="kana-host-toggle kana-focus absolute -left-9 top-1/2 z-20 h-20 w-9 -translate-y-1/2 text-accent hover:text-accent-hover"
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
