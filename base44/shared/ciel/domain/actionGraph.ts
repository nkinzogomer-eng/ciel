// Action Dependency Graph (amendment 5) + replay policy (amendment 4.1).
// Before executing, Ciel knows: preconditions, dependencies, affected state, expected
// observations, verification, rollback — and whether the action may be replayed after an interruption.
import { CielError } from '../core/types.ts';

export const RiskClass = Object.freeze({ PURE: 'PURE', REVERSIBLE: 'REVERSIBLE', IRREVERSIBLE: 'IRREVERSIBLE' });
export const ReplayPolicy = Object.freeze({ REPLAY_ALLOWED: 'REPLAY_ALLOWED', PROBE_BEFORE_REPLAY: 'PROBE_BEFORE_REPLAY' });

export function riskClass(manifest) {
  if (!manifest.side_effects || manifest.side_effects.length === 0) return RiskClass.PURE;
  return manifest.reversible ? RiskClass.REVERSIBLE : RiskClass.IRREVERSIBLE;
}

export function replayPolicy(manifest) {
  return manifest.idempotent ? ReplayPolicy.REPLAY_ALLOWED : ReplayPolicy.PROBE_BEFORE_REPLAY;
}

export function createActionPlan({
  id, decision_id, task_id, action, manifest, preconditions = [], dependencies = [],
  affected_state = [], expected_observations = [], verification = null, rollback = null, now,
}) {
  if (!id || !task_id) throw new CielError('MISSING_ID', 'action plan id and task_id are required');
  if (!manifest || typeof manifest.idempotent !== 'boolean' || typeof manifest.reversible !== 'boolean') {
    throw new CielError('MANIFEST_REQUIRED', 'an action plan requires the capability manifest (idempotent, reversible, side_effects)');
  }
  const risk = riskClass(manifest);
  if (risk !== RiskClass.PURE && affected_state.length === 0) {
    throw new CielError('AFFECTED_STATE_REQUIRED', 'a side-effecting action must declare the state it affects');
  }
  return {
    id, decision_id: decision_id || null, task_id,
    action: { capability: action.capability, params: action.params || {} },
    preconditions, dependencies, affected_state, expected_observations, verification, rollback,
    risk_class: risk,
    replay_policy: replayPolicy(manifest),
    irreversible_without_rollback: risk === RiskClass.IRREVERSIBLE && !rollback,
    created_at: now,
  };
}

// Which knowledge/evidence/decision ids become stale if this action runs (spec §24).
export function invalidatedBy(actionPlan, items) {
  const affected = new Set(actionPlan.affected_state);
  return items.filter((it) => (it.dependencies || []).some((d) => affected.has(d))).map((it) => it.id);
}