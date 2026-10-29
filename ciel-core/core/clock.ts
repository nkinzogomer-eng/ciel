// Clock interface. The Core never calls Date.now() directly: time is injected,
// which makes deadlines, staleness and recovery deterministic in tests.
import { CielError } from './types.ts';

export const SystemClock = Object.freeze({ now: () => new Date().toISOString() });

export function fixedClock(iso = '2026-01-01T00:00:00.000Z') {
  let current = iso;
  return {
    now: () => current,
    set: (v) => { current = v; },
    advanceMs: (ms) => { current = new Date(Date.parse(current) + ms).toISOString(); },
  };
}

export function assertClock(clock) {
  if (!clock || typeof clock.now !== 'function') throw new CielError('INVALID_CLOCK', 'clock.now() is required');
  return clock;
}