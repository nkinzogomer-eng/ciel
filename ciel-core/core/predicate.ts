// Deterministic predicate evaluation (no AI, no eval()).
// Shared by the Verification Engine (§18) and the Invalidation Engine (§24) so that
// "did this succeed?" and "is this still true?" are answered by the same rules.
import { CielError } from './types.ts';
import { deepEqual } from './fingerprint.ts';

// 'a.b[0].c' -> nested read. Returns undefined when any segment is missing.
export function getPath(target, path) {
  if (path === undefined || path === null || path === '' || path === '$') return target;
  const segments = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s !== '');
  let cur = target;
  for (const s of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[s];
  }
  return cur;
}

export const OPS = Object.freeze({
  eq: (a, b) => deepEqual(a, b),
  neq: (a, b) => !deepEqual(a, b),
  gt: (a, b) => typeof a === 'number' && typeof b === 'number' && a > b,
  gte: (a, b) => typeof a === 'number' && typeof b === 'number' && a >= b,
  lt: (a, b) => typeof a === 'number' && typeof b === 'number' && a < b,
  lte: (a, b) => typeof a === 'number' && typeof b === 'number' && a <= b,
  exists: (a) => a !== undefined && a !== null,
  absent: (a) => a === undefined || a === null,
  contains: (a, b) => (typeof a === 'string' ? a.includes(String(b)) : Array.isArray(a) && a.some((x) => deepEqual(x, b))),
  in: (a, b) => Array.isArray(b) && b.some((x) => deepEqual(x, a)),
  length_eq: (a, b) => (typeof a === 'string' || Array.isArray(a)) && a.length === b,
});

export function evaluate(actual, op, expected) {
  const fn = OPS[op];
  if (!fn) throw new CielError('UNKNOWN_OPERATOR', `unknown predicate operator "${op}" (available: ${Object.keys(OPS).join(', ')})`);
  return fn(actual, expected);
}

// predicate: { path, op, value }
export function evaluatePredicate(target, predicate) {
  if (!predicate || typeof predicate !== 'object' || typeof predicate.op !== 'string') {
    throw new CielError('INVALID_PREDICATE', 'predicate must be { path, op, value }');
  }
  const actual = getPath(target, predicate.path);
  return { passed: evaluate(actual, predicate.op, predicate.value), actual, predicate };
}

export function describePredicate(p) {
  return `${p.path ?? '$'} ${p.op}${p.value === undefined ? '' : ` ${JSON.stringify(p.value)}`}`;
}