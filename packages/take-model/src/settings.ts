/**
 * Take settings and refine configuration (Document 3 §4).
 *
 * This package is shared by the app, the workers and the metrics harness, so it
 * must stay dependency-free and side-effect-free — a worker importing these
 * types should not drag in React, Three or the storage layer.
 *
 * Everything here is persisted inside `take.json`, so the shapes are versioned
 * and additive-only. Reading an older take must never throw; `withDefaults`
 * below exists so a take written before a field was introduced still loads.
 */

/** Smoothing algorithms implemented in `mocap-core` (Document 3 §12.2). */
export type SmoothingMethod = 'butterworth' | 'savgol' | 'kalman-rts';

export interface SmoothingSettings {
  method: SmoothingMethod;
  /**
   * Cutoff in Hz at the take's own frame rate. 6Hz keeps deliberate human
   * motion (which lives below ~5Hz) while removing estimator noise above it.
   */
  cutoffHz: number;
}

export interface FootContactSettings {
  /** Metres above the fitted ground plane below which a foot may be planted. */
  heightThresholdMeters: number;
  /** Metres/second below which a foot is slow enough to be planted. */
  speedThresholdMps: number;
  /**
   * Hysteresis width. A contact only starts after this many consecutive frames
   * satisfy the raw condition, and only ends after this many consecutive frames
   * fail it — without this, contacts flicker on and off every other frame.
   */
  minConsecutiveFrames: number;
}

export interface RefineSettings {
  /**
   * Longest run of low-confidence frames that may be interpolated. Anything
   * longer is left as a flagged hole rather than invented, because a fabricated
   * half-second of motion is worse than an honest gap.
   */
  maxGapFrames: number;
  /** Confidence below which a frame counts as missing rather than noisy. */
  confidenceThreshold: number;
  smoothing: SmoothingSettings;
  footContact: FootContactSettings;
}

export interface TakeSettings {
  /**
   * Null until the user supplies it. The ground-scale stage cannot run without
   * it, which is why the refine configuration UI blocks on this field rather
   * than guessing an average human height.
   */
  subjectHeightMeters: number | null;
  cameraFovDegrees: number;
  /** One Euro parameters used for the *live* pass. Not used by refine. */
  filter: { minCutoff: number; beta: number; dCutoff: number };
  refine: RefineSettings;
}

/** Mirrors `ONE_EURO_DEFAULTS` in the Rust core and the editor store. */
export const FILTER_DEFAULTS = { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 } as const;

export const REFINE_DEFAULTS: RefineSettings = {
  maxGapFrames: 12,
  confidenceThreshold: 0.3,
  smoothing: { method: 'butterworth', cutoffHz: 6 },
  footContact: {
    heightThresholdMeters: 0.03,
    speedThresholdMps: 0.15,
    minConsecutiveFrames: 3,
  },
};

export const TAKE_SETTINGS_DEFAULTS: TakeSettings = {
  subjectHeightMeters: null,
  cameraFovDegrees: 60,
  filter: { ...FILTER_DEFAULTS },
  refine: REFINE_DEFAULTS,
};

/**
 * Fills in any missing field from defaults.
 *
 * Takes recorded by Document 2 have no `settings` block at all, and takes
 * recorded by future versions may have fields this build predates. Both must
 * load, so every read goes through here rather than trusting the JSON shape.
 */
export function withTakeSettingsDefaults(partial: unknown): TakeSettings {
  const input = (partial ?? {}) as Partial<TakeSettings>;
  const refine = (input.refine ?? {}) as Partial<RefineSettings>;
  const smoothing = (refine.smoothing ?? {}) as Partial<SmoothingSettings>;
  const footContact = (refine.footContact ?? {}) as Partial<FootContactSettings>;
  const filter = (input.filter ?? {}) as Partial<TakeSettings['filter']>;

  const height = input.subjectHeightMeters;

  return {
    // Guard against a corrupt or absurd stored value; `null` means "still ask".
    subjectHeightMeters:
      typeof height === 'number' && Number.isFinite(height) && height > 0.5 && height < 3
        ? height
        : null,
    cameraFovDegrees: numberOr(input.cameraFovDegrees, TAKE_SETTINGS_DEFAULTS.cameraFovDegrees),
    filter: {
      minCutoff: numberOr(filter.minCutoff, FILTER_DEFAULTS.minCutoff),
      beta: numberOr(filter.beta, FILTER_DEFAULTS.beta),
      dCutoff: numberOr(filter.dCutoff, FILTER_DEFAULTS.dCutoff),
    },
    refine: {
      maxGapFrames: numberOr(refine.maxGapFrames, REFINE_DEFAULTS.maxGapFrames),
      confidenceThreshold: numberOr(
        refine.confidenceThreshold,
        REFINE_DEFAULTS.confidenceThreshold,
      ),
      smoothing: {
        method: isSmoothingMethod(smoothing.method)
          ? smoothing.method
          : REFINE_DEFAULTS.smoothing.method,
        cutoffHz: numberOr(smoothing.cutoffHz, REFINE_DEFAULTS.smoothing.cutoffHz),
      },
      footContact: {
        heightThresholdMeters: numberOr(
          footContact.heightThresholdMeters,
          REFINE_DEFAULTS.footContact.heightThresholdMeters,
        ),
        speedThresholdMps: numberOr(
          footContact.speedThresholdMps,
          REFINE_DEFAULTS.footContact.speedThresholdMps,
        ),
        minConsecutiveFrames: Math.max(
          1,
          Math.round(
            numberOr(
              footContact.minConsecutiveFrames,
              REFINE_DEFAULTS.footContact.minConsecutiveFrames,
            ),
          ),
        ),
      },
    },
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isSmoothingMethod(value: unknown): value is SmoothingMethod {
  return value === 'butterworth' || value === 'savgol' || value === 'kalman-rts';
}

/** Human-readable "≈0.4s at 30fps" helper used by the refine config UI (§9.2). */
export function describeGapLength(frames: number, fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return `${frames} frames`;
  return `${frames} frames (≈${(frames / fps).toFixed(2)}s at ${Math.round(fps)}fps)`;
}
