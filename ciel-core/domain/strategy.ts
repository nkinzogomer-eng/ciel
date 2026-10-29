// Strategy model (spec §22, §23, amendment 7 — sunk cost independence).
// Historical performance is stored PER CONTEXT. There is deliberately no global score.
import { CielError } from '../core/types.ts';
import { createConfidence } from './confidence.ts';

export const StrategyStatus = Object.freeze({ CANDIDATE: 'CANDIDATE', SELECTED: 'SELECTED', ABANDONED: 'ABANDONED', COMPLETED: 'COMPLETED' });

export function createStrategy({
  id, mission_id, objective, approach, prerequisites = [], expected_outcome = null, cost = {},
  time_estimate_ms = null, risk = 'unknown', confidence = createConfidence(), fallback_strategy_id = null,
  applicability = {}, now,
}) {
  if (!id || !mission_id) throw new CielError('MISSING_ID', 'strategy id and mission_id are required');
  if (!objective || !approach) throw new CielError('INVALID_STRATEGY', 'objective and approach are required');
  return {
    id, mission_id, objective, approach, prerequisites, expected_outcome, cost, time_estimate_ms, risk, confidence,
    fallback_strategy_id, applicability, historical_performance: [],
    status: StrategyStatus.CANDIDATE, abandoned_reason: null, sunk_cost_at_abandon: null,
    created_at: now, updated_at: now,
  };
}

// Generalization boundary (spec §23): outcomes are recorded with the conditions under which they held.
export function recordStrategyOutcome(strategy, { context, outcome, cost = {}, now }) {
  if (!context || Object.keys(context).length === 0) {
    throw new CielError('CONTEXT_REQUIRED', 'a strategy outcome must record the context in which it occurred');
  }
  return { ...strategy, historical_performance: [...strategy.historical_performance, { context, outcome, cost, at: now }], updated_at: now };
}

function contextMatches(recorded, current) {
  return Object.entries(recorded).every(([k, v]) => Array.isArray(v) ? v.includes(current[k]) : current[k] === v);
}

export function applicabilityMatches(strategy, context) {
  return contextMatches(strategy.applicability, context);
}

export function performanceIn(strategy, context) {
  const relevant = strategy.historical_performance.filter((r) => contextMatches(r.context, context));
  return {
    attempts: relevant.length,
    successes: relevant.filter((r) => r.outcome === 'SUCCESS').length,
    insufficient_data: relevant.length < 3,
  };
}

// Sunk cost independence: abandonment records what was already spent, and that spend is
// explicitly NOT an input to the decision — only the invalidating evidence is.
export function abandonStrategy(strategy, { reason, evidence_ids = [], spent = {}, now }) {
  if (!evidence_ids.length) throw new CielError('EVIDENCE_REQUIRED', 'abandoning a strategy must cite the evidence that invalidated it');
  return { ...strategy, status: StrategyStatus.ABANDONED, abandoned_reason: reason, abandon_evidence_ids: evidence_ids, sunk_cost_at_abandon: spent, updated_at: now };
}