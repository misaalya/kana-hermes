"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectShowGate } from "@/lib/services/workspace-setup";
import { getCopy } from "@/lib/ui/copy";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { btnPrimary, btnSecondary } from "./ui";

/** Whether the workspace should stand down and show the cable screen. */
export function useConnectionGate(): boolean {
  const ready = useKanaStore("conversations", (state) => state.ready);
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const wizardMode = useKanaStore("workspace", (state) => state.wizardMode);
  return selectShowGate({ ready, connectionState, wizardMode });
}

/** Matches the screen's opacity transition in app/globals.css. */
const GATE_LEAVE_MS = 320;
/** How often the gate rereads the configured Instabox machine's state. */
const INSTABOX_STATUS_POLL_MS = 20_000;

export type ConnectionScreenController = {
  /** Hermes is unreachable: the workspace stands down. */
  blocked: boolean;
  /** The screen is on screen, including the moment after a successful connect. */
  visible: boolean;
  /** The screen is fading out; the workspace may mount underneath. */
  leaving: boolean;
  /** The workspace's avatar and chat should stay unmounted. */
  connectionDown: boolean;
  /** The relay reported connected and the seating animation is playing. */
  playing: boolean;
  /** The seating animation ended; step the screen away. */
  finish(): void;
};

/** One state for the screen and the workspace that steps aside for it. */
export function useConnectionScreen(): ConnectionScreenController {
  const workspace = useKanaWorkspace();
  const blocked = useConnectionGate();
  const connectionState = useKanaStore("agentSession", (state) => state.connectionState);
  const seatPending = useKanaStore("workspace", (state) => state.seatPending);
  const plugged = connectionState === "connected";
  const [leaving, setLeaving] = useState(false);
  const playing = seatPending && plugged && !blocked && !leaving;

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => {
      setLeaving(false);
      workspace.stores.workspace.setState({ seatPending: false });
    }, GATE_LEAVE_MS);
    return () => window.clearTimeout(done);
  }, [leaving, workspace]);

  const finish = useCallback(() => {
    setLeaving(true);
  }, []);

  return {
    blocked,
    visible: blocked || (seatPending && plugged),
    leaving,
    connectionDown: blocked || (seatPending && plugged && !leaving),
    playing,
    finish,
  };
}

const PLAY_FRAME_COUNT = 60;
const PLAY_TOTAL_MS = 500;
const PLAY_TAIL_MS = 120;
const PLAY_FRAME_MS = (PLAY_TOTAL_MS - PLAY_TAIL_MS) / (PLAY_FRAME_COUNT - 1);
const PLAY_SETTLE_MS = 180;
const IDLE_SETTLE_MS = 240;
const FRAME_WIDTH = 1120;
const FRAME_HEIGHT = 280;

type GateStageMode = "idle" | "try" | "play";
type GatePose = Exclude<GateStageMode, "play">;

function frameSource(index: number): string {
  return `/kana-gate/frame-${String(index + 1).padStart(3, "0")}.png`;
}

/**
 * The two ends of the Hermes cable. While Hermes is unreachable they reach for
 * each other from frame 1 of the recording. When the relay reports connected
 * they settle back onto that frame's exact marks, then the recording plays.
 */
function ConnectionStage({
  mode,
  pose,
  label,
  onPlayed,
}: {
  mode: GateStageMode;
  pose: GatePose;
  label: string;
  onPlayed(): void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const framesReadyRef = useRef<Promise<boolean> | null>(null);
  const onPlayedRef = useRef(onPlayed);

  useEffect(() => {
    onPlayedRef.current = onPlayed;
  }, [onPlayed]);

  // Load and decode the whole sequence while the gate waits, so playback never
  // stalls after a successful connect.
  useEffect(() => {
    const frames = Array.from({ length: PLAY_FRAME_COUNT }, (_, index) => {
      const frame = new Image();
      frame.src = frameSource(index);
      return frame;
    });
    framesRef.current = frames;
    framesReadyRef.current = Promise.all(
      frames.map((frame) => frame.decode().then(() => true, () => false)),
    ).then((results) => results.every(Boolean));
    return () => {
      framesReadyRef.current = null;
      framesRef.current = [];
    };
  }, []);

  // The rendered pose lags the requested one only on the way back: a failed
  // attempt eases into the idle reach instead of restarting it from frame 1.
  const [visualPose, setVisualPose] = useState<GatePose>(pose);
  const idleSettleRef = useRef<Animation[] | null>(null);

  const releaseIdleSettle = useCallback(() => {
    const animations = idleSettleRef.current;
    if (!animations) return;
    idleSettleRef.current = null;
    for (const animation of animations) animation.cancel();
    const stage = stageRef.current;
    if (!stage) return;
    const pieces = Array.from(
      stage.querySelectorAll<HTMLElement>(".kana-connection-piece"),
    );
    for (const piece of pieces) piece.style.animation = "";
  }, []);

  useEffect(() => {
    if (pose === "try") {
      releaseIdleSettle();
      if (visualPose === "try") return;
      const frame = window.requestAnimationFrame(() => setVisualPose("try"));
      return () => window.cancelAnimationFrame(frame);
    }
    if (visualPose !== "try" || mode === "play") return;
    const stage = stageRef.current;
    if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setVisualPose("idle"));
      return () => window.cancelAnimationFrame(frame);
    }
    const pieces = Array.from(
      stage.querySelectorAll<HTMLElement>(".kana-connection-piece"),
    );
    const animations = pieces.map((piece) => {
      const current = getComputedStyle(piece).transform;
      piece.style.animation = "none";
      return piece.animate(
        [{ transform: current }, { transform: "none" }],
        {
          duration: IDLE_SETTLE_MS,
          easing: "cubic-bezier(0.3, 0.7, 0.3, 1)",
          fill: "forwards",
        },
      );
    });
    idleSettleRef.current = animations;
    void Promise.all(
      animations.map((animation) => animation.finished.catch(() => {})),
    ).then(() => {
      // Hold the eased pose until the idle class lands; the layout effect then
      // releases the override so the idle loop starts from that same pose.
      if (idleSettleRef.current === animations) setVisualPose("idle");
    });
  }, [mode, pose, releaseIdleSettle, visualPose]);

  useLayoutEffect(() => {
    if (visualPose === "idle") releaseIdleSettle();
  }, [releaseIdleSettle, visualPose]);

  useEffect(() => releaseIdleSettle, [releaseIdleSettle]);

  useEffect(() => {
    if (mode !== "play") return;
    // A failed attempt may still be easing back; the recording owns the handoff.
    releaseIdleSettle();
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!stage || !canvas || !context) return;

    const pieces = Array.from(
      stage.querySelectorAll<HTMLElement>(".kana-connection-piece"),
    );
    // A previous playback may have left the canvas up.
    canvas.style.visibility = "hidden";
    for (const piece of pieces) piece.style.visibility = "visible";

    // Capture the wobble where it is, stop it, and ease each half back onto
    // its frame-1 mark. Playback then starts from a frame that matches those
    // marks exactly.
    const restores = pieces.map((piece) => {
      const current = getComputedStyle(piece).transform;
      const previous = piece.style.animation;
      piece.style.animation = "none";
      const animation =
        current && current !== "none"
          ? piece.animate([{ transform: current }, { transform: "none" }], {
              duration: PLAY_SETTLE_MS,
              easing: "cubic-bezier(0.3, 0.7, 0.3, 1)",
              fill: "forwards",
            })
          : null;
      return { piece, previous, animation };
    });

    let cancelled = false;
    let frameHandle = 0;
    let tailTimer = 0;

    const draw = (index: number) => {
      const frame = framesRef.current[index];
      if (!frame) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    };

    const finish = () => {
      if (!cancelled) onPlayedRef.current();
    };

    const play = async () => {
      await Promise.all(restores.map(({ animation }) => animation?.finished.catch(() => {})));
      if (cancelled) return;
      const ready = await (framesReadyRef.current ?? Promise.resolve(false));
      if (cancelled) return;
      if (!ready) {
        // The sequence is local; if it cannot load, still let the workspace in.
        tailTimer = window.setTimeout(finish, 250);
        return;
      }
      draw(0);
      for (const piece of pieces) piece.style.visibility = "hidden";
      canvas.style.visibility = "visible";
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        draw(PLAY_FRAME_COUNT - 1);
        tailTimer = window.setTimeout(finish, 450);
        return;
      }
      const startedAt = performance.now();
      let shown = 0;
      const tick = (now: number) => {
        if (cancelled) return;
        const index = Math.min(
          PLAY_FRAME_COUNT - 1,
          Math.floor((now - startedAt) / PLAY_FRAME_MS),
        );
        if (index !== shown) {
          shown = index;
          draw(index);
        }
        if (index >= PLAY_FRAME_COUNT - 1) {
          tailTimer = window.setTimeout(finish, PLAY_TAIL_MS);
          return;
        }
        frameHandle = window.requestAnimationFrame(tick);
      };
      frameHandle = window.requestAnimationFrame(tick);
    };

    void play();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameHandle);
      window.clearTimeout(tailTimer);
      for (const { piece, previous, animation } of restores) {
        animation?.cancel();
        piece.style.animation = previous;
        piece.style.visibility = "visible";
      }
      canvas.style.visibility = "hidden";
    };
  }, [mode, releaseIdleSettle]);

  return (
    <div
      ref={stageRef}
      role="img"
      aria-label={label}
      className={`kana-connection-stage ${visualPose === "try" ? "is-trying" : "is-idle"}`}
    >
      <canvas
        ref={canvasRef}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        aria-hidden="true"
        className="kana-connection-canvas"
      />
      {/* The cutouts share the playback canvas's stage, so plain images keep
          them pixel-aligned; the Next image optimizer would not help here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/kana-gate/plug.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="kana-connection-piece kana-connection-piece--plug"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/kana-gate/socket.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="kana-connection-piece kana-connection-piece--socket"
      />
    </div>
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
  const [waking, setWaking] = useState(false);
  const [wakeNotice, setWakeNotice] = useState<string | null>(null);
  const [instaboxAwake, setInstaboxAwake] = useState<boolean | null>(null);
  const connectionInTransition = connectionState === "connecting";
  const plugged = connectionState === "connected";
  const connectingPhase = connectPhase === "connecting" || connectPhase === "auto_starting";
  const busy = connectionInTransition || connectingPhase;
  // The wake belongs to the remote transport's Instabox block: without one,
  // there is nothing Kana could wake.
  const remote = hermesRuntime?.mode === "remote";
  const remoteWake = Boolean(
    remote && hermesRuntime?.wakeAvailable && hermesRuntime.authAvailable,
  );

  // The screen reports whether the server-side runtime is listening; Kana can
  // start one itself and the relay then connects.
  useEffect(() => {
    if (screen.blocked) void workspace.setup.inspectForGate();
  }, [screen.blocked, workspace]);

  const refreshInstaboxStatus = useCallback(async (): Promise<boolean | null> => {
    try {
      const response = await fetch("/api/hermes/wake", { cache: "no-store" });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { awake?: unknown } | null;
      return typeof body?.awake === "boolean" ? body.awake : null;
    } catch {
      return null;
    }
  }, []);

  // A wake is only meaningful while the machine sleeps. Poll the configured
  // machine so the action grays out the moment it comes up, including when it
  // was woken from outside Kana.
  useEffect(() => {
    if (!screen.visible || !remoteWake || waking || plugged) return;
    let cancelled = false;
    const check = async () => {
      const awake = await refreshInstaboxStatus();
      if (!cancelled && awake !== null) setInstaboxAwake(awake);
    };
    void check();
    const timer = window.setInterval(() => void check(), INSTABOX_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [plugged, refreshInstaboxStatus, remoteWake, screen.visible, waking]);

  if (!screen.visible) return null;

  const copy = getCopy(locale);
  const text = copy.workspace;
  const gateCopy = copy.gate;
  // A paused Instabox is an ordinary state, not a local Hermes failure: the
  // heading says what is unreachable and the wake action is the way out.
  const remoteOffline = remoteWake && connectionState === "error";
  const configError = Boolean(hermesRuntime?.configError);
  // A gateway Kana can see but not authenticate: Hermes was started without a
  // session token in its environment, so only that process knows the token.
  const adoptionBlocked =
    hermesRuntime &&
    hermesRuntime.state === "running" &&
    !hermesRuntime.managed &&
    !hermesRuntime.tokenAvailable &&
    !remote
      ? hermesRuntime
      : null;
  const detectedExternalGateway = Boolean(
    !remote && hermesRuntime?.state === "running" && !hermesRuntime.managed,
  );
  const runtimeHint = !hermesRuntime || adoptionBlocked
    ? null
    : configError
      ? gateCopy.configInvalid
      : remote
        ? hermesRuntime.authAvailable
          ? gateCopy.remoteConfigured
          : gateCopy.remoteAuthMissing
        : detectedExternalGateway
          ? gateCopy.detectedExternal(hermesRuntime.port)
          : hermesRuntime.state === "running" && hermesRuntime.managed
            ? gateCopy.managedRunning(hermesRuntime.pid ?? null)
            : hermesRuntime.executable
              ? null
              : gateCopy.missingBinary;
  const showRuntimeHint =
    Boolean(hermesRuntime?.controlAvailable || remote || configError)
    && !plugged
    && Boolean(runtimeHint || hermesRuntimeNotice);
  // Keep the seated frame on screen through the fade: leaving is only set
  // once playback has finished. The pose class must not change at the moment
  // playback starts, or the settle would lose the wobble it is easing out of.
  const stageMode =
    screen.playing || (screen.leaving && !screen.blocked) ? "play" : busy || waking ? "try" : "idle";
  const stagePose = stageMode === "play" || busy || waking ? "try" : "idle";

  const connect = () => {
    setWakeNotice(null);
    void workspace.actions.connectHermes();
  };

  const wake = async () => {
    setWaking(true);
    setWakeNotice(null);
    try {
      const response = await fetch("/api/hermes/wake", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      if (!response.ok) {
        setWakeNotice(
          body?.code === "busy"
            ? gateCopy.wakeBusy
            : body?.code === "unavailable"
              ? gateCopy.wakeUnavailable
              : body?.code === "timeout"
                ? gateCopy.wakeTimeout
                : gateCopy.wakeFailed,
        );
        return;
      }
      // The CLI reported the machine up; keep the action grayed from here on
      // even before the next status poll confirms it.
      setInstaboxAwake(true);
      await workspace.actions.connectHermes();
      // A retry already in flight owns the gate; only a settled, non-connected
      // state is a failed post-wake connection worth naming.
      const state = workspace.stores.agentSession.getState().connectionState;
      if (state !== "connected" && state !== "connecting" && state !== "reconnecting") {
        setWakeNotice(gateCopy.wakeConnectFailed);
      }
    } catch {
      setWakeNotice(gateCopy.wakeFailed);
    } finally {
      setWaking(false);
    }
  };

  return (
    <section
      aria-label={text.gatewayAria}
      className={`kana-connection-screen absolute inset-0 z-10 flex flex-col items-center overflow-hidden bg-bg px-6 pb-10 pt-24 text-center ${screen.leaving && !screen.blocked ? "is-leaving" : ""}`}
    >
      {/* The art keeps its own slot so a longer status text never moves it. */}
      <div className="kana-connection-art mt-[16vh] w-full animate-kana-in">
        <ConnectionStage
          mode={stageMode}
          pose={stagePose}
          label={plugged ? gateCopy.illustrationPlugged : gateCopy.illustration}
          onPlayed={screen.finish}
        />
      </div>

      <div className="flex w-full flex-1 flex-col items-center">
        <h2
          aria-live="polite"
          className={`mt-2 text-xl font-bold sm:text-2xl ${plugged || busy || waking || remoteOffline ? "text-ink" : "text-danger"}`}
        >
          {plugged ? (
            gateCopy.connectedTitle
          ) : waking ? (
            <>
              {gateCopy.wakingTitle}
              <ConnectingDots />
            </>
          ) : busy ? (
            <>
              {connectionState === "reconnecting" ? gateCopy.reconnecting : gateCopy.connectingTitle}
              <ConnectingDots />
            </>
          ) : adoptionBlocked ? (
            gateCopy.externalTokenStatus
          ) : connectionState === "authentication_failed" ? (
            gateCopy.authInvalid
          ) : connectionState === "incompatible" ? (
            gateCopy.incompatible
          ) : remoteOffline ? (
            gateCopy.remoteOfflineTitle
          ) : connectionState === "error" ? (
            gateCopy.failed
          ) : (
            text.gatewayTitle
          )}
        </h2>

        {remoteOffline && !busy && !waking ? (
          <p className="mt-4 w-full max-w-lg text-center text-[11.5px] leading-relaxed text-muted">
            {instaboxAwake === true ? gateCopy.remoteAwakeBody : gateCopy.remoteOfflineBody}
          </p>
        ) : null}

        {waking ? (
          <p
            role="status"
            className="mt-4 w-full max-w-lg text-center text-[11.5px] leading-relaxed text-muted"
          >
            {gateCopy.wakingBody}
          </p>
        ) : null}

        {adoptionBlocked && !busy ? (
          <p className="mt-4 w-full max-w-prose text-center text-sm leading-6 text-muted">
            {gateCopy.externalTokenBody(adoptionBlocked.port)}
          </p>
        ) : null}

        {remoteWake ? (
          <div className="mt-7 flex w-full max-w-sm flex-row items-center justify-center gap-3">
            <button
              type="button"
              className={`${instaboxAwake === true ? btnSecondary : btnPrimary} min-w-0 flex-1 whitespace-nowrap text-sm`}
              onClick={() => void wake()}
              disabled={busy || waking || plugged || instaboxAwake === true}
            >
              {waking
                ? gateCopy.wakingInstabox
                : instaboxAwake === true
                  ? gateCopy.instaboxAwake
                  : gateCopy.wakeInstabox}
            </button>
            <button
              type="button"
              className={`${btnSecondary} min-w-0 flex-1 whitespace-nowrap text-sm`}
              onClick={connect}
              disabled={busy || waking || plugged}
            >
              {connectionInTransition || connectPhase === "connecting"
                ? gateCopy.connecting
                : gateCopy.connectAgain}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${btnPrimary} mt-7 min-w-52 text-sm`}
            onClick={connect}
            disabled={busy || waking || plugged}
          >
            {plugged
              ? gateCopy.connected
              : connectionInTransition || connectPhase === "connecting"
                ? gateCopy.connecting
                : connectPhase === "auto_starting"
                  ? gateCopy.startButton
                  : adoptionBlocked
                    ? gateCopy.connectAgain
                    : gateCopy.connectButton}
          </button>
        )}

        {wakeNotice ? (
          <p role="status" className="mt-3 max-w-lg text-[11px] leading-relaxed text-faint">
            {wakeNotice}
          </p>
        ) : null}

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
      </div>
    </section>
  );
}
