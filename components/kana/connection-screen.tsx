"use client";

import { useEffect, useState } from "react";
import { selectShowGate } from "@/lib/services/workspace-setup";
import { getCopy } from "@/lib/ui/copy";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { StatusPill } from "./settings-layout";
import { btnPrimary } from "./ui";

/** Whether the workspace should stand down and show the cable screen. */
export function useConnectionGate(): boolean {
  const ready = useKanaStore("conversations", (state) => state.ready);
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  const connectionGateOpen = useKanaStore("workspace", (state) => state.connectionGateOpen);
  const automaticConnectFinished = useKanaStore("workspace", (state) => state.automaticConnectFinished);
  return selectShowGate({
    ready,
    connectionState,
    wizardMode,
    connectionGateOpen,
    automaticConnectFinished,
  });
}

export type ConnectionScreenController = {
  /** Hermes is unreachable: the workspace stands down. */
  blocked: boolean;
  /** The screen is on screen, including the moment after a successful connect. */
  visible: boolean;
  /** The screen is fading out; the workspace may mount underneath. */
  leaving: boolean;
  /** The workspace's avatar and chat should stay unmounted. */
  connectionDown: boolean;
  /** The user asked to connect; keep the plug seated once it lands. */
  start(): void;
};

/** One state for the screen and the workspace that steps aside for it. */
export function useConnectionScreen(): ConnectionScreenController {
  const blocked = useConnectionGate();
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const plugged = connectionState === "connected";
  // A manual attempt keeps the screen up so the plug is seen seating.
  const [linger, setLinger] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!linger || blocked || !plugged) return;
    // Let the plug finish seating before the workspace steps back in.
    const hold = window.setTimeout(() => setLeaving(true), 700);
    const done = window.setTimeout(() => setLinger(false), 1040);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [linger, blocked, plugged]);

  return {
    blocked,
    visible: blocked || (linger && plugged),
    leaving,
    connectionDown: blocked || (linger && !leaving),
    start() {
      setLinger(true);
      setLeaving(false);
    },
  };
}

/** A cable on its way to the socket; it seats while the relay is connecting. */
function CableIllustration({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 560 320" role="img" aria-label={label} className="h-auto max-h-[38vh] w-full">
      <defs>
        <clipPath id="kana-connection-body">
          <rect x="228" y="150" width="132" height="72" rx="22" />
        </clipPath>
        <clipPath id="kana-connection-socket">
          <rect x="428" y="94" width="104" height="140" rx="28" />
        </clipPath>
      </defs>

      <ellipse cx="280" cy="278" rx="212" ry="18" fill="#000" opacity=".08" />

      <path
        d="M520 184 C 546 186, 552 206, 572 212"
        fill="none"
        stroke="#000"
        strokeOpacity=".1"
        strokeWidth="24"
        strokeLinecap="round"
        transform="translate(0 8)"
      />
      <path
        d="M520 184 C 546 186, 552 206, 572 212"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="22"
        strokeLinecap="round"
      />

      <g>
        <rect x="428" y="94" width="104" height="140" rx="28" fill="var(--accent)" />
        <g clipPath="url(#kana-connection-socket)">
          <rect x="428" y="196" width="104" height="38" fill="#000" opacity=".1" />
          <rect x="496" y="94" width="36" height="140" fill="#000" opacity=".08" />
        </g>
        <rect x="434" y="152" width="56" height="62" rx="16" fill="#000" opacity=".26" />
        <circle cx="448" cy="120" r="4" fill="#000" opacity=".18" />
        <circle cx="448" cy="230" r="4" fill="#000" opacity=".18" />
      </g>

      <g className="kana-connection-plug">
        <g className="kana-connection-float">
          <path
            d="M-150 248 C -30 272, 110 260, 224 196"
            fill="none"
            stroke="#000"
            strokeOpacity=".12"
            strokeWidth="24"
            strokeLinecap="round"
            transform="translate(0 8)"
          />
          <path
            d="M-150 248 C -30 272, 110 260, 224 196"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="24"
            strokeLinecap="round"
          />

          <rect x="202" y="174" width="34" height="30" rx="11" fill="var(--accent)" />
          <rect x="202" y="174" width="34" height="13" rx="8" fill="#000" opacity=".1" />

          <rect x="228" y="150" width="132" height="72" rx="22" fill="var(--accent)" />
          <g clipPath="url(#kana-connection-body)">
            <rect x="228" y="198" width="132" height="24" fill="#000" opacity=".1" />
            <rect x="336" y="150" width="24" height="72" fill="#000" opacity=".06" />
          </g>
          <rect x="244" y="166" width="5" height="40" rx="2.5" fill="#000" opacity=".1" />
          <rect x="256" y="166" width="5" height="40" rx="2.5" fill="#000" opacity=".1" />

          <rect x="358" y="162" width="28" height="48" rx="10" fill="var(--accent)" />
          <rect x="372" y="162" width="14" height="48" rx="7" fill="#000" opacity=".1" />

          <rect x="384" y="170" width="30" height="10" rx="5" fill="var(--on-accent)" opacity=".55" />
          <rect x="384" y="192" width="30" height="10" rx="5" fill="var(--on-accent)" opacity=".55" />

          <g className="kana-connection-alert">
            <circle cx="254" cy="170" r="12" fill="var(--danger)" opacity=".16" />
            <circle cx="254" cy="170" r="6" fill="var(--danger)" className="kana-connection-led" />
            <path
              d="M418 140 l9 -20 l-1 16 l13 -9"
              fill="none"
              stroke="var(--danger)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}

/**
 * The workspace while Hermes is unreachable: the avatar and chat step away,
 * the header stays, and the cable plugs in as the relay connects.
 */
export function ConnectionScreen({ screen }: { screen: ConnectionScreenController }) {
  const workspace = useKanaWorkspace();
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const connectPhase = useKanaStore("workspace", (state) => state.connectPhase);
  const hermesRuntime = useKanaStore("workspace", (state) => state.hermesRuntime);
  const hermesRuntimeNotice = useKanaStore("workspace", (state) => state.hermesRuntimeNotice);
  const hermesRuntimeBusy = useKanaStore("workspace", (state) => state.hermesRuntimeBusy);
  const connectionInTransition = connectionState === "connecting" || connectionState === "reconnecting";
  const failed =
    connectionState === "error" ||
    connectionState === "authentication_failed" ||
    connectionState === "incompatible";
  const plugged = connectionState === "connected";
  const busy = connectionInTransition || connectPhase === "auto_starting";

  // The screen reports whether the server-side runtime is listening; Kana can
  // start one itself and the relay then connects.
  useEffect(() => {
    if (screen.blocked) void workspace.setup.inspectForGate();
  }, [screen.blocked, workspace]);

  if (!screen.visible) return null;

  const copy = getCopy(locale);
  const text = copy.workspace;
  const gateCopy = copy.gate;
  const detectedExternalGateway = Boolean(hermesRuntime?.state === "running" && !hermesRuntime.managed);
  const statusText = plugged
    ? gateCopy.connected
    : connectionState === "connecting"
      ? gateCopy.connecting
      : connectionState === "reconnecting"
        ? gateCopy.reconnecting
        : connectionState === "authentication_failed"
          ? gateCopy.authInvalid
          : connectionState === "incompatible"
            ? gateCopy.incompatible
            : connectionState === "error"
              ? gateCopy.failed
              : gateCopy.idle;
  const stateClass = plugged ? "is-plugged" : busy ? "is-busy" : "is-unplugged";

  const connect = () => {
    screen.start();
    void workspace.actions.connectHermes();
  };

  return (
    <section
      aria-label={text.gatewayAria}
      className={`kana-connection-screen absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden bg-bg px-6 pb-10 pt-24 text-center ${stateClass} ${screen.leaving && !screen.blocked ? "is-leaving" : ""}`}
    >
      <div className="w-[min(82vw,560px)] animate-kana-in">
        <CableIllustration label={plugged || busy ? gateCopy.illustrationPlugged : gateCopy.illustration} />
      </div>

      <h2 className="mt-2 text-xl font-bold text-ink sm:text-2xl">
        {plugged ? gateCopy.connectedTitle : text.gatewayTitle}
      </h2>

      <div role="status" className="mt-2.5">
        <StatusPill tone={plugged ? "ok" : busy ? "busy" : failed ? "error" : "idle"} capitalize={false}>
          {statusText}
        </StatusPill>
      </div>

      <button
        type="button"
        className={`${btnPrimary} mt-7 min-w-52 text-sm`}
        onClick={connect}
        disabled={busy || plugged}
      >
        {plugged
          ? gateCopy.connected
          : connectionInTransition
            ? gateCopy.connecting
            : connectPhase === "auto_starting"
              ? gateCopy.startButton
              : gateCopy.connectButton}
      </button>

      {hermesRuntime?.controlAvailable && !plugged ? (
        <div className="mt-4 flex max-w-xs flex-col items-center gap-1 text-[11px] leading-relaxed">
          {detectedExternalGateway ? (
            <p className="text-faint">{gateCopy.detectedExternal(hermesRuntime.port)}</p>
          ) : hermesRuntime.state === "running" && hermesRuntime.managed ? (
            <p className="text-faint">{gateCopy.managedRunning(hermesRuntime.pid ?? null)}</p>
          ) : hermesRuntime.executable ? (
            <p className="text-faint">{hermesRuntimeBusy ? gateCopy.startButton : gateCopy.installedReady}</p>
          ) : (
            <p className="text-faint">{gateCopy.missingBinary}</p>
          )}
          {hermesRuntimeNotice ? (
            <p role="status" className="max-w-full break-words text-faint">
              {hermesRuntimeNotice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
