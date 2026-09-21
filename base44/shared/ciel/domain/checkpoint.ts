// Checkpoint model (spec §29, amendment 4.1, fundamental test #10).
// A checkpoint is historical state. Restoring it never means "the world is as it was":
// every in-flight action is classified before anything is replayed.
import { CielError } from '../core/types.ts';
import { ReplayPolicy } from './actionGraph.ts';

export const RecoveryAction = Object.freeze({
  REPLAY: 'REPLAY',                        // idempotent: safe to run again
  PROBE_EFFECT_FIRST: 'PROBE_EFFECT_FIRST', // non-idempotent: check whether the effect already happened
});

export function createCheckpoint({
  id, mission_id, ledger_sequence, mission, tasks, knowledge_ids = [], decision_ids = [],
  state_fingerprints = {}, in_flight_actions = [], now,
}) {
  if (!id || !mission_id) throw new CielError('MISSING_ID', 'checkpoint id and mission_id are required');
  if (!Number.isInteger(ledger_sequence) || ledger_sequence < 0) throw new CielError('INVALID_SEQUENCE', 'ledger_sequence must be >= 0');
  if (!mission || !Array.isArray(tasks)) throw new CielError('INVALID_SNAPSHOT', 'mission and tasks snapshots are required');
  for (const a of in_flight_actions) {
    if (!a.task_id || !a.capability || typeof a.idempotent !== 'boolean' || !a.started_at) {
      throw new CielError('INVALID_IN_FLIGHT', 'in-flight action needs { task_id, capability, params, idempotent, started_at }');
    }
  }
  return {
    id, mission_id, ledger_sequence,
    mission: structuredClone(mission), tasks: structuredClone(tasks),
    knowledge_ids, decision_ids, state_fingerprints: { ...state_fingerprints },
    in_flight_actions: structuredClone(in_flight_actions),
    created_at: now,
  };
}

// The Recovery rule: a non-idempotent action is NEVER blindly replayed after an interruption.
export function recoveryPlan(checkpoint) {
  return checkpoint.in_flight_actions.map((a) => ({
    task_id: a.task_id,
    capability: a.capability,
    replay_policy: a.idempotent ? ReplayPolicy.REPLAY_ALLOWED : ReplayPolicy.PROBE_BEFORE_REPLAY,
    action: a.idempotent ? RecoveryAction.REPLAY : RecoveryAction.PROBE_EFFECT_FIRST,
    effect_probe: a.effect_probe || null,
  }));
}