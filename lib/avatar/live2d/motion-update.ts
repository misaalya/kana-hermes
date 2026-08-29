/**
 * AIRI-style motion-manager update hook, ported from the reference project's
 * `stage-ui-live2d` package (`motion-manager.ts`) and adapted to Kana:
 *
 * - Kana drives expressions through the SDK ExpressionManager, so only the
 *   plugin stages themselves are ported, not the exp3 parsing pipeline.
 * - The lip-sync plugin writes a configurable parameter ID because Kana's
 *   per-model bindings allow models whose mouth is not `ParamMouthOpenY`
 *   (for example Mao, bound to `ParamA`).
 *
 * The hook replaces `internalModel.motionManager.update` so plugins observe —
 * and can own — parameters on every Cubism update, instead of racing motions
 * from outside the update loop.
 */

export type MotionUpdateCoreModel = {
  setParameterValueById(id: string, value: number): void;
  getParameterValueById(id: string): number;
};

export type MotionManagerLike = {
  update(model: MotionUpdateCoreModel, now: number): boolean | void;
  state?: { currentGroup?: string | null } | null;
  groups?: { idle?: string } | null;
};

export type MotionUpdateContext = {
  /** The Cubism core model receiving parameter writes this frame. */
  model: MotionUpdateCoreModel;
  /** Update timestamp in seconds, as provided by the runtime. */
  now: number;
  /** Seconds since the previous update (0 on the first frame). */
  timeDelta: number;
  /** True while no user-requested motion group is playing. */
  isIdleMotion: boolean;
  handled: boolean;
  markHandled(): void;
};

export type MotionUpdatePlugin = (context: MotionUpdateContext) => void;

export type MotionUpdatePluginStage = "pre" | "post" | "final";

export function createMotionUpdateHook(motionManager: MotionManagerLike): {
  register(plugin: MotionUpdatePlugin, stage?: MotionUpdatePluginStage): void;
} {
  const stages: Record<MotionUpdatePluginStage, MotionUpdatePlugin[]> = {
    pre: [],
    post: [],
    final: [],
  };
  const originalUpdate = motionManager.update.bind(motionManager);
  let lastUpdateAt = 0;

  motionManager.update = (model, now) => {
    const timeDelta = lastUpdateAt ? now - lastUpdateAt : 0;
    const currentGroup = motionManager.state?.currentGroup;
    const idleGroup = motionManager.groups?.idle;
    const context: MotionUpdateContext = {
      model,
      now,
      timeDelta,
      isIdleMotion: !currentGroup || currentGroup === idleGroup,
      handled: false,
      markHandled() {
        context.handled = true;
      },
    };

    runStage(stages.pre, context);
    if (!context.handled && originalUpdate(model, now)) {
      context.handled = true;
    }
    runStage(stages.post, context);
    // Final plugins always run regardless of the handled state so they can
    // layer corrections (lip sync, expression overrides) on top of motions.
    for (const plugin of stages.final) plugin(context);

    lastUpdateAt = now;
    return context.handled;
  };

  return {
    register(plugin, stage = "pre") {
      stages[stage].push(plugin);
    },
  };
}

function runStage(
  plugins: MotionUpdatePlugin[],
  context: MotionUpdateContext,
): void {
  for (const plugin of plugins) {
    if (context.handled) break;
    plugin(context);
  }
}

/**
 * Final-phase lip-sync plugin, ported from AIRI's
 * `useMotionUpdatePluginLipSync`.
 *
 * While speech is active the plugin owns the mouth parameter outright, so an
 * idle motion curve can never reopen the mouth between audio amplitude
 * samples. When speech ends it cross-fades back to the motion-driven value
 * over a short release tail, then holds the mouth shut briefly longer so the
 * first idle frame cannot visibly reopen it.
 */
export function createLipSyncPlugin(options: {
  mouthOpenParameterId: string;
  getMouthOpen(): number;
  isSpeaking(): boolean;
}): MotionUpdatePlugin {
  // Covers a typical phoneme tail without lagging behind the next utterance.
  const RELEASE_DURATION_MS = 200;
  // Keeps forcing the mouth shut after the release tail so a non-zero idle
  // curve cannot reopen it immediately after speech ends.
  const HANDOFF_HOLD_MS = 500;

  let releaseRemainingMs = 0;
  let handoffRemainingMs = 0;
  let lastForcedValue = 0;

  // Smoothstep: 3t^2 - 2t^3, easing with zero slope at both endpoints.
  const smoothstep = (t: number) => t * t * (3 - 2 * t);

  return (context) => {
    if (options.isSpeaking()) {
      lastForcedValue = Math.max(0, Math.min(1, options.getMouthOpen()));
      releaseRemainingMs = RELEASE_DURATION_MS;
      handoffRemainingMs = HANDOFF_HOLD_MS;
      context.model.setParameterValueById(
        options.mouthOpenParameterId,
        lastForcedValue,
      );
      return;
    }

    if (releaseRemainingMs <= 0) {
      if (handoffRemainingMs > 0) {
        handoffRemainingMs = Math.max(
          0,
          handoffRemainingMs - context.timeDelta * 1000,
        );
        context.model.setParameterValueById(options.mouthOpenParameterId, 0);
      }
      return;
    }

    releaseRemainingMs = Math.max(
      0,
      releaseRemainingMs - context.timeDelta * 1000,
    );
    const blend = smoothstep(1 - releaseRemainingMs / RELEASE_DURATION_MS);

    // The motion + expression pipeline already wrote its value this frame.
    const motionValue = context.model.getParameterValueById(
      options.mouthOpenParameterId,
    );
    const blended =
      lastForcedValue * (1 - blend) + motionValue * blend;

    context.model.setParameterValueById(options.mouthOpenParameterId, blended);
  };
}
