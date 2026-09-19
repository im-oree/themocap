/**
 * Process-wide master clock and rate meter.
 *
 * `MasterClock` is deliberately not a singleton (it is a plain, injectable
 * class so tests can drive it with a fake `nowMs`). But the UI needs *one*
 * shared instance to read from, and threading it through React context from the
 * capture pipeline — which does not exist yet — would be premature. This module
 * is that shared handle, and the capture worker will adopt it rather than
 * creating its own.
 */

import { MasterClock, RateMeter } from './masterClock';

let clock: MasterClock | null = null;
let meter: RateMeter | null = null;

export function getMasterClock(): MasterClock {
  clock ??= new MasterClock({ source: 'wall' });
  return clock;
}

export function getRateMeter(): RateMeter {
  meter ??= new RateMeter(30);
  return meter;
}

/** Test-only: drops the shared instances so each test starts clean. */
export function resetClockInstances(): void {
  clock = null;
  meter = null;
}
