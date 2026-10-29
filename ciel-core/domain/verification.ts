// Verification records and the resolution rule (spec §18, amendment 4.4).
// Absolute rule: without an applicable verifier, a result can never become VERIFIED.
import { CielError, VerificationState, VerifierKind, assertOneOf } from '../core/types.ts';

// A task's verification spec: { kind: VerifierKind, ...verifier-specific fields }
// PREDICATE:               { kind, predicate: { path, op, value } }
// INDEPENDENT_OBSERVATION: { kind, capability, params, compare: { path } }
// CONSISTENCY:             { kind, against: [knowledge ids] }
// HUMAN_ATTESTATION:       { kind, question }
export function applicableVerifier(spec) {
  if (!spec || typeof spec !== 'object') return null;
  return Object.prototype.hasOwnProperty.call(VerifierKind, spec.kind) ? spec.kind : null;
}

export function resolveVerificationState({ verifier_kind, required = [], satisfied = [], contradictions = [] }) {
  if (contradictions.length > 0) return VerificationState.CONTRADICTED;
  if (!verifier_kind) return VerificationState.UNVERIFIED;
  if (required.length === 0) return VerificationState.UNKNOWN;
  if (satisfied.length >= required.length) return VerificationState.VERIFIED;
  if (satisfied.length > 0) return VerificationState.PARTIALLY_VERIFIED;
  return VerificationState.UNVERIFIED;
}

export function createVerificationRecord({
  id, subject_id, subject_type, verifier_kind = null, required_evidence = [], satisfied_evidence = [],
  contradictions = [], available_evidence_ids = [], notes = '', performed_by = 'ciel', now,
}) {
  if (!id || !subject_id) throw new CielError('MISSING_ID', 'verification record id and subject_id are required');
  if (verifier_kind !== null) assertOneOf(VerifierKind, verifier_kind, 'verifier_kind');
  if (typeof performed_by === 'string' && performed_by.startsWith('ai:')) {
    // Spec §40: the model is not the judge.
    throw new CielError('AI_CANNOT_VERIFY', 'verification must be performed by Ciel mechanisms, not by a model');
  }
  const state = resolveVerificationState({ verifier_kind, required: required_evidence, satisfied: satisfied_evidence, contradictions });
  return {
    id, subject_id, subject_type, verifier_kind, required_evidence, satisfied_evidence, contradictions,
    available_evidence_ids, unverified: required_evidence.filter((r) => !satisfied_evidence.includes(r)),
    state, notes, performed_by, created_at: now,
  };
}