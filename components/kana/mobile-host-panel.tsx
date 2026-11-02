"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatDuration, percentUsed } from "@/lib/host/host-metrics";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useKanaStore } from "./kana-workspace-context";
import { useHostSnapshot, type HostReading } from "./use-host-snapshot";

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

/** Two zero-padded groups, the fixed-width form the header readout reserves. */
function uptimeGroups(seconds: number): [string, string] {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return [pad(days), pad(hours)];
  if (hours > 0) return [pad(hours), pad(minutes)];
  return [pad(minutes), pad(whole % 60)];
}

function statusClass(reading: HostReading): string {
  if (reading.snapshot) return "text-ink-dim";
  return reading.error ? "text-danger" : "animate-kana-pulse text-muted";
}

function HostRow({
  label,
  value,
  secondary,
  detail,
  reserveDetail = false,
  loading = false,
}: {
  label: string;
  value: string;
  secondary?: string;
  detail?: string;
  /** Keep the detail slot before a reading arrives, so the rows do not move. */
  reserveDetail?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-1 shrink-0 flex-col justify-center py-3">
      <p className="text-[8px] font-extrabold uppercase leading-[1.2] tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        data-host-value=""
        className={`mt-1.5 text-[22px] font-extrabold leading-[0.95] tabular-nums ${
          loading ? "animate-kana-pulse text-faint" : "text-ink"
        }`}
      >
        {value}
        {secondary ? (
          <span className="block">{secondary}</span>
        ) : null}
      </p>
      {reserveDetail ? (
        <p className="mt-2 min-h-[4.35em] text-[8px] font-bold leading-[1.45] text-faint">
          {detail ?? "\u00A0"}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The rail behind the phone edge tab. It always renders the same four rows:
 * while the first sample is on its way the readings show a pulsing dash, so
 * the panel and its tab keep the loaded size instead of growing into it.
 */
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
  const loading = !snapshot && !error;
  const status = snapshot?.hostname ?? (error ? settings.hostFailed : settings.hostLoading);

  return (
    <div className="flex flex-col px-2.5 pb-2 text-right">
      <div className="flex flex-1 flex-col divide-y divide-dotted divide-line-strong">
        <div className="shrink-0 pb-2.5 pt-3">
          <p className="text-[8px] font-extrabold uppercase leading-[1.2] tracking-[0.1em] text-muted">
            {settings.hostTitle}
          </p>
          <p
            className={`mt-1 line-clamp-2 min-h-[2.2em] break-words text-[9.5px] font-extrabold leading-[1.1] ${statusClass(reading)}`}
            title={status}
          >
            {status}
          </p>
        </div>
        <HostRow
          label={settings.hostCpu}
          value={snapshot && cpu !== null ? `${Math.round(cpu)}%` : "—"}
          loading={loading}
        />
        <HostRow
          label={settings.hostMemory}
          value={snapshot && memory !== null ? `${Math.round(memory)}%` : "—"}
          loading={loading}
        />
        <HostRow
          label={settings.hostDisk}
          value={snapshot && disk !== null ? `${Math.round(disk)}%` : "—"}
          loading={loading}
        />
        <HostRow
          label={settings.hostUptime}
          value={snapshot ? uptimeValue : "—"}
          // The loading row keeps the second line's height without inventing a reading.
          secondary={snapshot ? uptimeSecondary : "\u00A0"}
          detail={snapshot
            ? snapshot.source === "remote"
              ? settings.hostHermesDetail(
                  formatDuration(snapshot.kana.uptime),
                  formatBytes(snapshot.kana.rss),
                )
              : settings.hostKanaDetail(
                  formatDuration(snapshot.kana.uptime),
                  formatBytes(snapshot.kana.rss),
                )
            : undefined}
          reserveDetail
          loading={loading}
        />
      </div>
      <p className="min-h-[1.45em] pt-1.5 text-[8px] font-bold leading-snug text-danger">
        {error && snapshot ? settings.hostFailed : "\u00A0"}
      </p>
    </div>
  );
}

/**
 * Focus mode on a phone: the free left side of the header row carries CPU,
 * memory, and disk as three compact label-over-value columns, in line with
 * the action tray. There is no hostname, uptime, frame, or extra band; the
 * conversation itself reaches the header.
 */
export function HeaderFocusHost() {
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const reading = useHostSnapshot({ active: true, freshForMs: CACHE_MS });
  const settings = getCopy(locale).settings;
  const { snapshot, cpu, error } = reading;
  const memory = snapshot
    ? percentUsed(snapshot.memory.total, snapshot.memory.available)
    : null;
  const disk = snapshot?.disk
    ? percentUsed(snapshot.disk.total, snapshot.disk.available)
    : null;
  const [uptimeValue, uptimeSecondary] = uptimeLines(snapshot?.uptime ?? 0);
  const uptimeTitle = snapshot ? `${uptimeValue} ${uptimeSecondary}` : undefined;
  const status = !snapshot ? (error ? settings.hostFailed : settings.hostLoading) : "";
  const percent = (value: number | null) =>
    snapshot && value !== null ? String(Math.round(value)) : "—";
  const metrics = [
    {
      label: settings.hostCpu,
      value: percent(cpu),
      suffix: snapshot && cpu !== null ? "%" : "",
      width: "min-w-[38px] sm:min-w-[50px]",
    },
    {
      label: settings.hostMemoryShort,
      value: percent(memory),
      suffix: snapshot && memory !== null ? "%" : "",
      width: "min-w-[38px] sm:min-w-[50px]",
    },
    {
      label: settings.hostDisk,
      value: percent(disk),
      suffix: snapshot && disk !== null ? "%" : "",
      width: "min-w-[38px] sm:min-w-[50px]",
    },
    {
      label: settings.hostUptimeShort,
      value: snapshot ? uptimeGroups(snapshot.uptime).join(" ") : "—",
      suffix: "",
      width: "min-w-[52px] sm:min-w-[64px]",
      title: uptimeTitle,
      // Below 375 px the three utilisation readings keep the row legible.
      className: "max-[374px]:hidden",
    },
  ];

  return (
    <section
      className="kana-focus-host flex shrink-0 items-center gap-2.5 sm:gap-3"
      aria-label={settings.hostTitle}
      title={snapshot?.hostname ?? status}
    >
      {metrics.map((metric) => (
        <span
          key={metric.label}
          data-host-metric=""
          className={`flex shrink-0 flex-col items-start ${metric.className ?? ""}`}
          title={metric.title}
        >
          <span
            className={`text-[8.5px] font-extrabold uppercase leading-none tracking-[0.04em] sm:text-[10px] ${
              error && !snapshot ? "text-danger" : "text-muted"
            }`}
          >
            {metric.label}
          </span>
          <span
            data-host-value=""
            className={`mt-1 inline-block whitespace-nowrap text-[18px] font-extrabold leading-none tabular-nums sm:text-[20px] ${metric.width} ${
              snapshot ? "text-ink" : error ? "text-danger" : "animate-kana-pulse text-faint"
            }`}
          >
            {metric.value}
            {metric.suffix ? (
              <span className="ml-px text-[0.55em]">{metric.suffix}</span>
            ) : null}
          </span>
        </span>
      ))}
      <p className="sr-only" role="status">{status}</p>
    </section>
  );
}

/**
 * Phones tuck the host rail behind a right-edge tab, shaped like the chat
 * dock's handle, while the avatar is on screen. With the avatar off, the rail
 * steps aside for the header readout, which the header itself mounts. The rail
 * stays mounted while closed, so its height keeps the tab in place instead of
 * letting it jump to the top; the strip is inert and off-screen until opened.
 */
export function MobileHostPanel() {
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const avatarVisible = useKanaStore("preferences", (state) => state.preferences.avatarVisible);
  const usesMobileChat = useKanaStore("workspace", (state) => state.usesMobileChat);
  const avatarLayoutOpen = useKanaStore("workspace", (state) => state.avatarLayoutOpen);
  const greeting = useKanaStore("workspace", (state) => state.greeting);
  const [open, setOpen] = useState(false);
  const text = getCopy(locale).workspace;
  const settings = getCopy(locale).settings;
  const available = usesMobileChat && avatarVisible && !greeting && !avatarLayoutOpen;
  const active = available && open;
  const reading = useHostSnapshot({ active, freshForMs: CACHE_MS });

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  if (!available) return null;

  return (
    <div className={`kana-host-dock ${open ? "" : "is-closed"}`}>
      <button
        type="button"
        className="kana-host-toggle kana-focus absolute -left-9 top-1/2 z-20 h-20 w-9 -translate-y-1/2 text-accent hover:text-accent-hover"
        aria-controls="kana-host-panel"
        aria-expanded={open}
        aria-label={open ? text.hideHost : text.showHost}
        onClick={() => setOpen((value) => !value)}
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
        <HostStrip locale={locale} reading={reading} />
      </section>
    </div>
  );
}
