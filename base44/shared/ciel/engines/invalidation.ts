// State Invalidation engine (spec §24, amendment 4.2, amendment 5) — Phase E.
// Two jobs:
//   1. Before acting: re-observe the preconditions and compare with the recorded fingerprint.
//   2. After acting: cascade staleness to everything that depended on the changed state.
import { CielError, Validity } from '../core/types.ts';
import { fingerprint } from '../core/fingerprint.ts';
import { evaluatePredicate, describePredicate } from '../core/predicate.ts';
import { markStale } from '../domain/knowledge.ts';
import { invalidateDecision } from '../domain/decision.ts';

// preconditions: [{ key, fingerprint }] or [{ key, path?, op, value }]
export async function recordPreconditions(keys, observe) {
  const out = [];
  for (const key of keys) out.push({ key, fingerprint: await fingerprint(await observe(key)) });
  return out;
}

export async function checkPreconditions(preconditions = [], observe) {
  if (preconditions.length && typeof observe !== 'function') {
    throw new CielError('OBSERVE_REQUIRED', 'checking preconditions requires an observe(key) function');
  }
  const failed = [];
  for (const pc of preconditions) {
    const observed = await observe(pc.key);
    if (pc.fingerprint !== undefined) {
      const current = await fingerprint(observed);
      if (current !== pc.fingerprint) failed.push({ key: pc.key, reason: 'state fingerprint changed', expected: pc.fingerprint, actual: current });
      continue;
    }
    if (pc.op !== undefined) {
      const { passed, actual } = evaluatePredicate(observed, { path: pc.path, op: pc.op, value: pc.value });
      if (!passed) failed.push({ key: pc.key, reason: `precondition not met: ${describePredicate(pc)}`, actual });
      continue;
    }
    throw new CielError('INVALID_PRECONDITION', `precondition on "${pc.key}" must carry a fingerprint or an operator`);
  }
  return { ok: failed.length === 0, failed };
}

// Transitive closure: items depending on changed state, then items depending on those items.
export function invalidationClosure(items, affectedState = []) {
  const affected = new Set(affectedState);
  const invalidated = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of items) {
      if (invalidated.has(it.id)) continue;
      if ((it.dependencies || []).some((d) => affected.has(d))) {
        invalidated.add(it.id);
        affected.add(it.id);
        changed = true;
      }
    }
  }
  return [...invalidated];
}

// Applies the closure: knowledge becomes STALE (re-observable), decisions become INVALID.
export function applyInvalidation(items, affectedState, { reason, now }) {
  const ids = new Set(invalidationClosure(items, affectedState));
  const updated = items.map((it) => {
    if (!ids.has(it.id)) return it;
    if (it.validity !== undefined && it.level !== undefined) return markStale(it, { reason, now });
    if (it.validity !== undefined) return invalidateDecision(it, { reason, now });
    return { ...it, validity: Validity.STALE, invalidation_reason: reason };
  });
  return { invalidated_ids: [...ids], items: updated };
}