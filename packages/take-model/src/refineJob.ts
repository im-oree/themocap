/**
 * Refine job state (Document 3 §4).
 *
 * Deliberately **not persisted**. A job is a running process, not a property of
 * the take, and a half-finished job restored from disk after a reload would be
 * a lie — the worker driving it is gone. Reloading mid-refine loses the job and
 * the user re-runs it; the pipeline is idempotent, so that is safe.
 */

/** Pipeline stages, in execution order (Document 3 §10-§12). */
export type RefineStage =
  | 'pose2d'
  | 'lift3d'
  | 'gapfill'
  | 'smooth'
  | 'bonelength'
  | 'ground-scale'
  | 'footlock'
  | 'root-cleanup'
  | 'finalize';

export const REFINE_STAGES: readonly RefineStage[] = [
  'pose2d',
  'lift3d',
  'gapfill',
  'smooth',
  'bonelength',
  'ground-scale',
  'footlock',
  'root-cleanup',
  'finalize',
];

/**
 * Relative cost of each stage, used to turn per-stage progress into a single
 * overall number. The two model stages dominate; the numerical cleanup stages
 * are cheap by comparison.
 *
 * These are estimates from the Document 1 bench figures and MUST be recalibrated
 * against real golden-clip timings — an overall progress bar that lies is worse
 * than none. Recorded in docs/decisions.md.
 */
export const STAGE_WEIGHTS: Readonly<Record<RefineStage, number>> = {
  pose2d: 0.45,
  lift3d: 0.3,
  gapfill: 0.02,
  smooth: 0.05,
  bonelength: 0.03,
  'ground-scale': 0.04,
  footlock: 0.07,
  'root-cleanup': 0.02,
  finalize: 0.02,
};

/** Human-readable stage labels for the Properties panel (§9.3). */
export const STAGE_LABELS: Readonly<Record<RefineStage, string>> = {
  pose2d: 'Running 2D pose (full resolution)…',
  lift3d: 'Lifting to 3D…',
  gapfill: 'Filling gaps…',
  smooth: 'Smoothing…',
  bonelength: 'Constraining bone lengths…',
  'ground-scale': 'Fitting ground plane…',
  footlock: 'Locking feet…',
  'root-cleanup': 'Cleaning root trajectory…',
  finalize: 'Finalizing…',
};

export type RefineStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'error'
  | 'done';

export interface RefineJobState {
  takeId: string | null;
  projectId: string | null;
  status: RefineStatus;
  stage: RefineStage;
  /** 0..1 within the current stage. */
  stageProgress: number;
  /** 0..1 across the whole pipeline. */
  overallProgress: number;
  startedAt: number | null;
  error?: string;
}

export const IDLE_REFINE_JOB: RefineJobState = {
  takeId: null,
  projectId: null,
  status: 'idle',
  stage: 'pose2d',
  stageProgress: 0,
  overallProgress: 0,
  startedAt: null,
};

/**
 * Overall progress = every completed stage's full weight, plus the current
 * stage's weight scaled by its own progress.
 */
export function computeOverallProgress(stage: RefineStage, stageProgress: number): number {
  const clamped = Math.min(1, Math.max(0, stageProgress));
  let total = 0;
  for (const candidate of REFINE_STAGES) {
    if (candidate === stage) {
      total += STAGE_WEIGHTS[candidate] * clamped;
      break;
    }
    total += STAGE_WEIGHTS[candidate];
  }
  return Math.min(1, total);
}

/**
 * Rough remaining-time estimate from elapsed time and progress so far.
 *
 * Returns null below 2% progress: early estimates are wild, and showing
 * "4 hours remaining" for the first second is worse than showing nothing.
 */
export function estimateRemainingSeconds(
  overallProgress: number,
  elapsedSeconds: number,
): number | null {
  if (overallProgress < 0.02 || elapsedSeconds <= 0) return null;
  const total = elapsedSeconds / overallProgress;
  return Math.max(0, total - elapsedSeconds);
}
