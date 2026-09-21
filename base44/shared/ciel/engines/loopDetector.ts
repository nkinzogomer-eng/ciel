// Loop detection (spec §31) — Phase F.
// Ciel must notice that it is repeating itself instead of burning the whole budget.
// Two shapes are detected: identical repetition, and oscillation between two outcomes.
import { fingerprint } from '../core/fingerprint.ts';

export const LoopKind = Object.freeze({
  REPEATED_IDENTICAL: 'REPEATED_IDENTICAL',
  OSCILLATION: 'OSCILLATION',
});

export function createLoopDetector({ threshold = 3 } = {}) {
  const history = [];

  function assess() {
    const counts = new Map();
    for (const h of history) {
      const sig = `${h.capability}|${h.params_fp}|${h.outcome_fp}`;
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
    for (const [signature, count] of counts) {
      if (count >= threshold) return { looping: true, kind: LoopKind.REPEATED_IDENTICAL, count, signature, reason: `the same action produced the same outcome ${count} times` };
    }
    // A,B,A,B on the same action+params: progress is not happening, it is alternating.
    const sameAction = history.filter((h) => history.length >= 4 && h.capability === history[history.length - 1].capability && h.params_fp === history[history.length - 1].params_fp);
    if (sameAction.length >= 4) {
      const tail = sameAction.slice(-4).map((h) => h.outcome_fp);
      if (tail[0] === tail[2] && tail[1] === tail[3] && tail[0] !== tail[1]) {
        return { looping: true, kind: LoopKind.OSCILLATION, count: 4, signature: `${history[history.length - 1].capability}|${tail[0]}<->${tail[1]}`, reason: 'the action alternates between two outcomes without converging' };
      }
    }
    return { looping: false, kind: null, count: 0, signature: null, reason: null };
  }

  return {
    async record({ capability, params = {}, outcome }) {
      history.push({ capability, params_fp: await fingerprint(params), outcome_fp: await fingerprint(outcome) });
      return assess();
    },
    assess,
    size() { return history.length; },
    reset() { history.length = 0; },
  };
}