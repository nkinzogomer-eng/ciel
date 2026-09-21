// Evidence and Observation models (spec §17, §26).
// Tool output -> Observation -> Integrity assessment -> Evidence. Never skip the assessment.
import { CielError, EvidenceKind, IntegrityStatus, assertOneOf } from '../core/types.ts';

export function createEvidence({ id, kind, subject_id, source, content, observation_id = null, integrity = IntegrityStatus.UNASSESSED, now }) {
  if (!id) throw new CielError('MISSING_ID', 'evidence id is required');
  assertOneOf(EvidenceKind, kind, 'evidence.kind');
  assertOneOf(IntegrityStatus, integrity, 'evidence.integrity');
  if (!source) throw new CielError('MISSING_SOURCE', 'evidence must name its source');
  return { id, kind, subject_id: subject_id || null, source, content, observation_id, integrity, created_at: now };
}

export function independentSources(evidence) {
  return new Set(evidence.map((e) => e.source)).size;
}

export function createObservation({ id, task_id, capability, params = {}, output, state_fingerprint = null, now }) {
  if (!id || !task_id) throw new CielError('MISSING_ID', 'observation id and task_id are required');
  if (!capability) throw new CielError('MISSING_CAPABILITY', 'observation must name the capability that produced it');
  return {
    id, task_id, capability, params, output, state_fingerprint,
    integrity: { status: IntegrityStatus.UNASSESSED, checks: [] },
    observed_at: now,
  };
}

// checks: [{ name, passed, note }]. All passed -> TRUSTED; any failed -> SUSPECT; none -> UNASSESSED.
export function assessIntegrity(observation, checks) {
  let status = IntegrityStatus.UNASSESSED;
  if (checks.length > 0) status = checks.every((c) => c.passed) ? IntegrityStatus.TRUSTED : IntegrityStatus.SUSPECT;
  return { ...observation, integrity: { status, checks: [...checks] } };
}

export function observationToEvidence(observation, { id, now }) {
  if (observation.integrity.status === IntegrityStatus.UNASSESSED) {
    throw new CielError('INTEGRITY_UNASSESSED', 'an observation must be integrity-assessed before it becomes evidence');
  }
  return createEvidence({
    id, kind: EvidenceKind.OBSERVATION, subject_id: observation.task_id,
    source: `capability:${observation.capability}`, content: observation.output,
    observation_id: observation.id, integrity: observation.integrity.status, now,
  });
}