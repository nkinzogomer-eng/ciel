// Confidence vector (spec §15). Four separated dimensions; overall = weakest link.
// An externally claimed confidence (from a model) is recorded but NEVER copied into internal values.
import { assertUnitInterval } from '../core/types.ts';

export const CONFIDENCE_DIMENSIONS = Object.freeze(['knowledge', 'evidence', 'reasoning', 'execution']);

export function createConfidence({ knowledge = 0, evidence = 0, reasoning = 0, execution = 0, claimed = null } = {}) {
  const c = { knowledge, evidence, reasoning, execution };
  for (const d of CONFIDENCE_DIMENSIONS) assertUnitInterval(c[d], `confidence.${d}`);
  return { ...c, claimed };
}

// overall_confidence is defined as the minimum of the four dimensions: a result is
// never more trustworthy than its least trustworthy component.
export function overallConfidence(c) {
  return Math.min(...CONFIDENCE_DIMENSIONS.map((d) => c[d]));
}

// A model's self-reported confidence becomes a *claim*. Internal dimensions stay at 0
// until Ciel's own evidence/verification raises them.
export function fromExternalClaim(claimed) {
  return createConfidence({ claimed: { ...claimed } });
}