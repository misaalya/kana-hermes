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

/**
 * A white plug and socket face each other on their cables with a spark in the
 * gap. While Hermes is unreachable they stay apart, prongs and holes in view;
 * once the relay reports connected the plug seats, its prongs disappear into
 * the socket, and the spark goes out.
 */
function CableIllustration({ label }: { label: string }) {
  return (
    <svg viewBox="60 40 640 250" role="img" aria-label={label} className="h-auto max-h-[40vh] w-full">
      <defs>
        <linearGradient id="kana-connection-body" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="var(--kana-plug-top)" />
          <stop offset="0.55" stopColor="var(--kana-plug-mid)" />
          <stop offset="1" stopColor="var(--kana-plug-shade)" />
        </linearGradient>
        <linearGradient id="kana-connection-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="kana-connection-face" x1="0" y1="0.35" x2="1" y2="0.65">
          <stop offset="0" stopColor="#828fa0" />
          <stop offset="0.5" stopColor="#727e8f" />
          <stop offset="1" stopColor="#6d7a89" />
        </linearGradient>
        <linearGradient id="kana-connection-slot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b343f" />
          <stop offset="0.55" stopColor="#2d3641" />
          <stop offset="1" stopColor="#2f3843" />
        </linearGradient>
        <linearGradient id="kana-connection-slot-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f5a67" />
          <stop offset="0.06" stopColor="#535e6c" />
          <stop offset="0.16" stopColor="#6e7986" />
          <stop offset="0.84" stopColor="#4f5b68" />
          <stop offset="0.94" stopColor="#626e7c" />
          <stop offset="1" stopColor="#6d7987" />
        </linearGradient>
        <linearGradient id="kana-connection-lip" x1="0.85" y1="1" x2="0.2" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#f7fafc" />
          <stop offset="1" stopColor="#eaf0f6" />
        </linearGradient>
        <filter id="kana-connection-slot-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.3" />
        </filter>
        <linearGradient id="kana-connection-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c3ccd5" />
          <stop offset="0.45" stopColor="var(--kana-metal)" />
          <stop offset="1" stopColor="var(--kana-metal-dark)" />
        </linearGradient>
        <linearGradient id="kana-connection-cord" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--kana-cord-light)" />
          <stop offset="0.45" stopColor="var(--kana-cord)" />
          <stop offset="1" stopColor="var(--kana-cord-shade)" />
        </linearGradient>
      </defs>

      <g className="kana-connection-hover">
        <g className="kana-connection-plug">
          {/* The plug cable runs in from off frame and enters the gland. */}
          <path
            d="M -140 246 C -58 258, 20 252, 72 228 C 98 216, 122 196, 140 192"
            fill="none"
            stroke="var(--kana-cord-shade)"
            strokeWidth="27"
            strokeLinecap="round"
          />
          <path
            d="M -140 246 C -58 258, 20 252, 72 228 C 98 216, 122 196, 140 192"
            fill="none"
            stroke="url(#kana-connection-cord)"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <path
            d="M -140 241 C -58 253, 20 247, 72 223 C 98 211, 122 191, 140 187"
            fill="none"
            stroke="var(--kana-cord-light)"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.7"
          />

          <rect
            x="136"
            y="152"
            width="46"
            height="56"
            rx="16"
            fill="url(#kana-connection-body)"
            stroke="var(--kana-plug-line)"
            strokeWidth="2"
          />
          <rect x="144" y="157" width="4" height="46" rx="2" fill="var(--kana-plug-deep)" opacity="0.28" />
          <rect x="153" y="157" width="4" height="46" rx="2" fill="var(--kana-plug-deep)" opacity="0.28" />
          <rect x="162" y="157" width="4" height="46" rx="2" fill="var(--kana-plug-deep)" opacity="0.28" />
          <path
            d="M 146 156 C 146 153, 150 152, 155 153 L 166 155"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.8"
          />

          <path
            d="M 194 140 C 214 140, 234 137, 252 134 C 270 131, 281 137, 281 148 L 281 212 C 281 223, 270 229, 252 226 C 234 223, 214 220, 194 220 C 181 219, 172 212, 172 206 L 172 154 C 172 148, 181 141, 194 140 Z"
            fill="url(#kana-connection-body)"
            stroke="var(--kana-plug-line)"
            strokeWidth="2"
          />
          <path
            d="M 194 145 C 214 142, 242 138, 268 139 L 268 182 C 240 179, 210 182, 176 193 L 174 164 C 174 158, 182 151, 194 145 Z"
            fill="url(#kana-connection-gloss)"
            opacity="0.5"
          />
          <path d="M 258 134 C 252 162, 252 198, 258 226" fill="none" stroke="var(--kana-plug-line)" strokeWidth="2" opacity="0.45" />
          <path d="M 204 140 C 200 162, 200 198, 204 220" fill="none" stroke="var(--kana-plug-line)" strokeWidth="2" opacity="0.25" />
          <path
            d="M 274 143 C 279 145, 281 148, 281 152 L 281 208 C 281 212, 279 215, 274 217"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.65"
          />
          <path
            d="M 194 210 C 214 214, 240 218, 264 222 L 256 226 C 234 223, 210 218, 194 214 Z"
            fill="var(--kana-plug-deep)"
            opacity="0.18"
          />

          <circle cx="236" cy="180" r="10" fill="var(--kana-plug-deep)" opacity="0.32" />
          <circle cx="236" cy="180" r="7.2" fill="var(--kana-plug-top)" opacity="0.9" />
          <path d="M 230.5 183 A 7 7 0 0 0 241.5 181" fill="none" stroke="var(--kana-plug-deep)" strokeWidth="2" opacity="0.35" />

          <rect x="240" y="208" width="24" height="6" rx="3" fill="var(--kana-plug-deep)" opacity="0.22" />
          <rect x="240" y="208" width="24" height="2.5" rx="1.25" fill="#ffffff" opacity="0.35" />
        </g>

        <g className="kana-connection-sparks">
          <g className="kana-connection-spark-pulse" fill="var(--accent)">
            <rect x="366" y="70" width="10" height="34" rx="5" />
            <rect x="330" y="82" width="10" height="30" rx="5" transform="rotate(-35 335 97)" />
            <rect x="402" y="82" width="10" height="30" rx="5" transform="rotate(35 407 97)" />
          </g>
        </g>

        <g className="kana-connection-socket">
          {/* The socket is seen three-quarters on: the slate face sits in a
              front collar, and the barrel steps back behind it. */}
          <g transform="rotate(4 458 180)">
            <path
              d="M 626 184 C 682 174, 732 204, 792 196 C 852 188, 902 200, 962 192"
              fill="none"
              stroke="var(--kana-cord-shade)"
              strokeWidth="27"
              strokeLinecap="round"
            />
            <path
              d="M 626 184 C 682 174, 732 204, 792 196 C 852 188, 902 200, 962 192"
              fill="none"
              stroke="url(#kana-connection-cord)"
              strokeWidth="20"
              strokeLinecap="round"
            />
            <path
              d="M 628 179 C 682 169, 732 199, 792 191 C 852 183, 902 195, 962 187"
              fill="none"
              stroke="var(--kana-cord-light)"
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.7"
            />

            <path
              d="M 524 133 C 548 131, 574 138, 604 153 L 604 207 C 580 237, 552 243, 524 240 Z"
              fill="url(#kana-connection-body)"
              stroke="var(--kana-plug-line)"
              strokeWidth="2"
            />
            <path
              d="M 540 138 C 560 136, 580 141, 600 154"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.5"
            />
            <path
              d="M 540 239 C 562 241, 584 233, 604 214 L 604 207 C 580 237, 556 242, 540 241 Z"
              fill="var(--kana-plug-deep)"
              opacity="0.16"
            />
            <circle cx="564" cy="174" r="10" fill="url(#kana-connection-body)" stroke="var(--kana-plug-line)" strokeWidth="2" />
            <circle cx="564" cy="173" r="7" fill="#ffffff" opacity="0.45" />
            <path d="M 557 178 A 9 9 0 0 0 571 175" fill="none" stroke="var(--kana-plug-deep)" strokeWidth="2.2" opacity="0.35" />

            <rect
              x="598"
              y="149"
              width="42"
              height="62"
              rx="16"
              fill="url(#kana-connection-body)"
              stroke="var(--kana-plug-line)"
              strokeWidth="2"
            />
            <rect x="606" y="154" width="3.5" height="52" rx="1.75" fill="var(--kana-plug-deep)" opacity="0.28" />
            <rect x="614" y="154" width="3.5" height="52" rx="1.75" fill="var(--kana-plug-deep)" opacity="0.28" />
            <rect x="622" y="154" width="3.5" height="52" rx="1.75" fill="var(--kana-plug-deep)" opacity="0.28" />
            <path
              d="M 607 153 C 607 150, 611 148, 616 149 L 626 151"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.8"
            />

            <g transform="translate(0 8)">
              <path
                d="M 448 180 C 448 148, 462 124, 486 118 C 505 117, 521 119, 532 127 C 539 144, 542 164, 542 184 C 542 204, 539 222, 532 232 C 519 240, 504 242, 486 242 C 462 236, 448 212, 448 180 Z"
                fill="url(#kana-connection-body)"
                stroke="var(--kana-plug-line)"
                strokeWidth="2"
              />
              <path
                d="M 452 153 A 36 58 0 0 1 476 125"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3.5"
                strokeLinecap="round"
                opacity="0.45"
              />
              <path d="M 517 224 A 38 62 0 0 0 522 198" fill="none" stroke="var(--kana-plug-deep)" strokeWidth="6" strokeLinecap="round" opacity="0.18" />

              <g transform="rotate(-2.3 483 182.5)">
                <ellipse
                  cx="483"
                  cy="182.5"
                  rx="26.7"
                  ry="50.6"
                  fill="url(#kana-connection-face)"
                  stroke="#5a6674"
                  strokeWidth="0.5"
                  strokeOpacity="0.3"
                />
                <ellipse cx="483" cy="182.5" rx="27.25" ry="51.15" fill="none" stroke="url(#kana-connection-lip)" strokeWidth="1.1" />
              </g>

              <g transform="translate(488.9 161.8)">
                <ellipse
                  rx="8.5"
                  ry="9.5"
                  fill="url(#kana-connection-slot-rim)"
                  filter="url(#kana-connection-slot-soft)"
                />
                <ellipse rx="6" ry="7.2" fill="url(#kana-connection-slot)" />
              </g>

              <g transform="translate(488.9 204.8)">
                <ellipse
                  rx="8.5"
                  ry="9.5"
                  fill="url(#kana-connection-slot-rim)"
                  filter="url(#kana-connection-slot-soft)"
                />
                <ellipse rx="6" ry="7.2" fill="url(#kana-connection-slot)" />
              </g>
            </g>
          </g>
        </g>

        {/* The pins ride above the socket face so their tips can enter the
            slots; the openings stay behind them and their far side still
            reads as the opening. The upper pin runs a little longer because
            the rotated socket puts its hole slightly further from the plug. */}
        <g className="kana-connection-prongs">
          <ellipse cx="278" cy="158" rx="5" ry="9" fill="var(--kana-plug-deep)" opacity="0.35" />
          <ellipse cx="278" cy="202" rx="5" ry="9" fill="var(--kana-plug-deep)" opacity="0.35" />
          <rect
            x="277"
            y="153"
            width="50"
            height="10"
            rx="5"
            fill="url(#kana-connection-metal)"
            stroke="var(--kana-metal-dark)"
            strokeWidth="1.5"
          />
          <rect x="277" y="155" width="42" height="2.5" rx="1.25" fill="var(--kana-metal-light)" opacity="0.75" />
          <rect
            x="277"
            y="197"
            width="48"
            height="10"
            rx="5"
            fill="url(#kana-connection-metal)"
            stroke="var(--kana-metal-dark)"
            strokeWidth="1.5"
          />
          <rect x="277" y="199" width="40" height="2.5" rx="1.25" fill="var(--kana-metal-light)" opacity="0.75" />
        </g>
      </g>
    </svg>
  );
}

/** The dots that keep time while Kana reaches Hermes again. */
function ConnectingDots() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setDots((count) => (count === 3 ? 1 : count + 1));
    }, 350);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span aria-hidden="true" className="inline-block w-[1.1em] text-left">
      {".".repeat(dots)}
    </span>
  );
}

/**
 * The workspace while Hermes is unreachable: the avatar and chat step away,
 * the header stays, and the cable seats once the relay reports connected.
 */
export function ConnectionScreen({ screen }: { screen: ConnectionScreenController }) {
  const workspace = useKanaWorkspace();
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const connectPhase = useKanaStore("workspace", (state) => state.connectPhase);
  const hermesRuntime = useKanaStore("workspace", (state) => state.hermesRuntime);
  const hermesRuntimeNotice = useKanaStore("workspace", (state) => state.hermesRuntimeNotice);
  const connectionInTransition = connectionState === "connecting";
  const plugged = connectionState === "connected";
  const connectingPhase = connectPhase === "connecting" || connectPhase === "auto_starting";
  const busy = connectionInTransition || connectingPhase;

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
  // Only a real outcome needs a pill: the heading carries the idle and
  // connecting states, so the gate never says the same thing twice.
  const statusText = plugged
    ? gateCopy.connected
    : busy
      ? null
      : connectionState === "authentication_failed"
        ? gateCopy.authInvalid
        : connectionState === "incompatible"
          ? gateCopy.incompatible
          : connectionState === "error"
            ? gateCopy.failed
            : null;
  const runtimeHint = !hermesRuntime
    ? null
    : detectedExternalGateway
      ? gateCopy.detectedExternal(hermesRuntime.port)
      : hermesRuntime.state === "running" && hermesRuntime.managed
        ? gateCopy.managedRunning(hermesRuntime.pid ?? null)
        : hermesRuntime.executable
          ? null
          : gateCopy.missingBinary;
  const showRuntimeHint =
    Boolean(hermesRuntime?.controlAvailable) && !plugged && Boolean(runtimeHint || hermesRuntimeNotice);
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
      <div className="kana-connection-art w-full max-w-[640px] animate-kana-in">
        <CableIllustration label={plugged ? gateCopy.illustrationPlugged : gateCopy.illustration} />
      </div>

      <h2
        aria-live="polite"
        className={`mt-2 text-xl font-bold sm:text-2xl ${plugged || busy ? "text-ink" : "text-danger"}`}
      >
        {plugged ? (
          gateCopy.connectedTitle
        ) : busy ? (
          <>
            {gateCopy.reconnecting}
            <ConnectingDots />
          </>
        ) : (
          text.gatewayTitle
        )}
      </h2>

      {statusText ? (
        <div role="status" className="mt-2.5">
          <StatusPill tone={plugged ? "ok" : "error"} capitalize={false}>
            {statusText}
          </StatusPill>
        </div>
      ) : null}

      <button
        type="button"
        className={`${btnPrimary} mt-7 min-w-52 text-sm`}
        onClick={connect}
        disabled={busy || plugged}
      >
        {plugged
          ? gateCopy.connected
          : connectionInTransition || connectPhase === "connecting"
            ? gateCopy.connecting
            : connectPhase === "auto_starting"
              ? gateCopy.startButton
              : gateCopy.connectButton}
      </button>

      {showRuntimeHint ? (
        <div className="mt-4 flex max-w-xs flex-col items-center gap-1 text-[11px] leading-relaxed">
          {runtimeHint ? <p className="text-faint">{runtimeHint}</p> : null}
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
