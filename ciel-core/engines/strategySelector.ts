// Strategy selection (spec §22, §23, amendment 7) — Phase D/G. Deterministic, no AI.
// Selection uses performance measured IN A MATCHING CONTEXT only, and abandonment is
// independent of what has already been spent.
import { CielError } from '../core/types.ts';
import { StrategyStatus, applicabilityMatches, performanceIn, abandonStrategy } from '../domain/strategy.ts';

export function selectStrategy(strategies, context) {
  const applicable = strategies.filter((s) => s.status === StrategyStatus.CANDIDATE && applicabilityMatches(s, context));
  if (applicable.length === 0) return { selected: null, reason: 'no candidate strategy is applicable in this context', considered: [] };

  const considered = applicable.map((s) => {
    const perf = performanceIn(s, context);
    return {
      id: s.id,
      contextual_success_rate: perf.attempts ? perf.successes / perf.attempts : null,
      attempts: perf.attempts,
      insufficient_data: perf.insufficient_data,
      cost: s.cost?.time_ms ?? s.time_estimate_ms ?? null,
    };
  });

  // Untested strategies are not ranked above measured ones, and a measured strategy is
  // only preferred once it has enough samples in THIS context.
  const measured = considered.filter((c) => !c.insufficient_data);
  const pool = measured.length ? measured : considered;
  const sorted = [...pool].sort((a, b) =>
    (b.contextual_success_rate ?? -1) - (a.contextual_success_rate ?? -1)
    || (a.cost ?? Infinity) - (b.cost ?? Infinity));

  return {
    selected: strategies.find((s) => s.id === sorted[0].id),
    reason: measured.length ? 'best measured success rate in a matching context' : 'no strategy has enough samples in this context: cheapest applicable candidate',
    considered,
  };
}

// Sunk cost independence: the decision depends only on the invalidating evidence.
export function reconsider(strategy, { invalidating_evidence_ids = [], spent = {}, now }) {
  if (!invalidating_evidence_ids.length) {
    return { action: 'CONTINUE', strategy, reason: 'no evidence invalidates the current strategy' };
  }
  const abandoned = abandonStrategy(strategy, { reason: 'evidence invalidated the strategy', evidence_ids: invalidating_evidence_ids, spent, now });
  return { action: 'ABANDON', strategy: abandoned, reason: 'invalidating evidence exists; already-spent resources are recorded but are not an input' };
}

export function assertSunkCostIgnored(decisionA, decisionB) {
  if (decisionA.action !== decisionB.action) {
    throw new CielError('SUNK_COST_LEAK', 'the same evidence produced different decisions for different spend levels');
  }
  return true;
}