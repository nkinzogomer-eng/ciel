// Cognitive Decision Primitive (spec §14, §15, §40).
// A decision proposed by an AI is UNCERTAIN until Ciel's own mechanisms validate it.
import { CielError, DecisionType, DecisionValidity, assertOneOf, assertUnitInterval } from '../core/types.ts';
import { createConfidence } from './confidence.ts';

function checkSelected(type, options, selected) {
  switch (type) {
    case DecisionType.BOOLEAN:
      if (typeof selected !== 'boolean') throw new CielError('INVALID_SELECTION', 'BOOLEAN decision requires a boolean');
      break;
    case DecisionType.CHOICE:
    case DecisionType.CLASSIFICATION:
      if (!options.includes(selected)) throw new CielError('INVALID_SELECTION', `${type} selection must be one of the options`);
      break;
    case DecisionType.RANK:
      if (!Array.isArray(selected) || selected.some((s) => !options.includes(s))) {
        throw new CielError('INVALID_SELECTION', 'RANK selection must be an ordered subset of the options');
      }
      break;
    case DecisionType.PROBABILITY:
      assertUnitInterval(selected, 'PROBABILITY selection');
      break;
    case DecisionType.SCORE:
    case DecisionType.ESTIMATE:
      if (typeof selected !== 'number' || Number.isNaN(selected)) throw new CielError('INVALID_SELECTION', `${type} requires a number`);
      break;
  }
}

export function createDecision({
  id, mission_id, task_id = null, type, question, options = [], selected, confidence = createConfidence(),
  evidence_ids = [], risks = [], made_by = 'ciel', verification_required = false,
  preconditions_fingerprint = null, dependencies = [], expected_outcome = null, fallback = null, reason = '', now,
}) {
  if (!id || !mission_id) throw new CielError('MISSING_ID', 'decision id and mission_id are required');
  assertOneOf(DecisionType, type, 'decision.type');
  if (!question) throw new CielError('MISSING_QUESTION', 'a decision must record the question it answers');
  checkSelected(type, options, selected);
  const external = typeof made_by === 'string' && made_by.startsWith('ai:');
  return {
    id, mission_id, task_id, type, question, options, selected, confidence, evidence_ids, risks, made_by, reason,
    // Principle 9: model output is not proof.
    validity: external ? DecisionValidity.UNCERTAIN : DecisionValidity.VALID,
    verification_required: external ? true : Boolean(verification_required),
    preconditions_fingerprint, dependencies, expected_outcome, fallback,
    superseded_by: null, invalidation_reason: null,
    created_at: now, updated_at: now,
  };
}

export function validateDecision(decision, { now, reason = 'validated by arbitration' }) {
  if (decision.validity === DecisionValidity.SUPERSEDED) throw new CielError('SUPERSEDED', 'cannot validate a superseded decision');
  return { ...decision, validity: DecisionValidity.VALID, reason, updated_at: now };
}

export function invalidateDecision(decision, { reason, now }) {
  return { ...decision, validity: DecisionValidity.INVALID, invalidation_reason: reason, updated_at: now };
}

export function supersedeDecision(decision, { by, now }) {
  return { ...decision, validity: DecisionValidity.SUPERSEDED, superseded_by: by, updated_at: now };
}