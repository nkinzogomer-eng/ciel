// Loop detection (spec §31) — Phase F.
// Ciel must notice that it is repeating itself instead of burning the whole budget.
// Two shapes are detected: identical repetition, and oscillation between two outcomes.
//
// Scope: history is keyed by mission. A detector attached to a long-lived runtime must not
// compare one mission's actions with another's — an operator running the same mission twice
// in a row is a legitimate repetition, not a loop. `record()` without a mission_id keeps the
// behaviour used by the unit tests (one implicit scope).
import { fingerprint } from '../core/fingerprint.ts';

export const LoopKind = Object.freeze({
  REPEATED_IDENTICAL: 'REPEATED_IDENTICAL',
  OSCILLATION: 'OSCILLATION',
});

const UNSCOPED = '__unscoped__';
const scopeOf = (mission_id) => mission_id ?? UNSCOPED;

export function createLoopDetector({ threshold = 3 } = {}) {
  let history = [];

  function assessFor(scope) {
    const scoped = history.filter((h) => h.scope === scope);
    const counts = new Map();
    for (const h of scoped) {
      const sig = `${h.capability}|${h.params_fp}|${h.outcome_fp}`;
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
    for (const [signature, count] of counts) {
      if (count >= threshold) return { looping: true, kind: LoopKind.REPEATED_IDENTICAL, count, signature, reason: `the same action produced the same outcome ${count} times` };
    }
    // A,B,A,B on the same action+params: progress is not happening, it is alternating.
    const last = scoped[scoped.length - 1];
    if (!last) return { looping: false, kind: null, count: 0, signature: null, reason: null };
    const sameAction = scoped.filter((h) => h.capability === last.capability && h.params_fp === last.params_fp);
    if (sameAction.length >= 4) {
      const tail = sameAction.slice(-4).map((h) => h.outcome_fp);
      if (tail[0] === tail[2] && tail[1] === tail[3] && tail[0] !== tail[1]) {
        return { looping: true, kind: LoopKind.OSCILLATION, count: 4, signature: `${last.capability}|${tail[0]}<->${tail[1]}`, reason: 'the action alternates between two outcomes without converging' };
      }
    }
    return { looping: false, kind: null, count: 0, signature: null, reason: null };
  }

  return {
    async record({ mission_id = null, capability, params = {}, outcome }) {
      const scope = scopeOf(mission_id);
      history.push({ scope, capability, params_fp: await fingerprint(params), outcome_fp: await fingerprint(outcome) });
      return assessFor(scope);
    },
    assess({ mission_id = null } = {}) { return assessFor(scopeOf(mission_id)); },
    // Each new execution window starts from a clean slate for that mission only.
    clear({ mission_id = null } = {}) {
      const scope = scopeOf(mission_id);
      const before = history.length;
      history = history.filter((h) => h.scope !== scope);
      return before - history.length;
    },
    size({ mission_id = null } = {}) {
      if (mission_id === null && arguments.length === 0) return history.length;
      const scope = scopeOf(mission_id);
      return history.filter((h) => h.scope === scope).length;
    },
    reset() { history = []; },
  };
}
