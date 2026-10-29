// Knowledge Model (spec §16, §17, §20, §25).
// UNKNOWN -> HYPOTHESIS -> INFERENCE -> CORROBORATED_INFERENCE -> OBSERVED_FACT -> VERIFIED_FACT
// Promotion requires evidence of the right kind. AI output enters as HYPOTHESIS, never as FACT.
import {
  CielError, KnowledgeKind, EpistemicLevel, EpistemicLevelName, Validity, EvidenceKind, IntegrityStatus, ConflictState,
  assertOneOf, assertUnitInterval,
} from '../core/types.ts';

const KIND_RANGE = {
  UNKNOWN: [0, 0], HYPOTHESIS: [1, 1], INFERENCE: [2, 3], FACT: [4, 5],
};

export function kindForLevel(level) {
  return Object.keys(KIND_RANGE).find((k) => level >= KIND_RANGE[k][0] && level <= KIND_RANGE[k][1]);
}

export function createKnowledgeItem({
  id, kind, statement, level, source, scope = 'mission', reliability = 0,
  evidence_ids = [], dependencies = [], now,
}) {
  if (!id) throw new CielError('MISSING_ID', 'knowledge id is required');
  assertOneOf(KnowledgeKind, kind, 'kind');
  if (typeof statement !== 'string' || !statement) throw new CielError('INVALID_STATEMENT', 'statement must be a non-empty string');
  if (!(level in EpistemicLevelName)) throw new CielError('INVALID_LEVEL', `unknown epistemic level ${level}`);
  if (kindForLevel(level) !== kind) {
    throw new CielError('LEVEL_KIND_MISMATCH', `kind ${kind} cannot have level ${EpistemicLevelName[level]}`);
  }
  assertUnitInterval(reliability, 'reliability');
  return {
    id, kind, statement, level, source: source || 'unknown', scope, reliability,
    evidence_ids: [...evidence_ids], dependencies: [...dependencies],
    validity: Validity.VALID, invalidation_reason: null,
    timestamp: now, last_verified: null, updated_at: now,
  };
}

export function createHypothesis({ id, statement, source, evidence_required = [], falsifiers = [], dependencies = [], now }) {
  return {
    ...createKnowledgeItem({ id, kind: KnowledgeKind.HYPOTHESIS, statement, level: EpistemicLevel.HYPOTHESIS, source, dependencies, now }),
    evidence_required, falsifiers, contradictions: [],
  };
}

// Principle 9: model output is not proof. An external claim is a hypothesis.
export function fromExternalClaim({ id, statement, provider, now }) {
  return createHypothesis({ id, statement, source: `ai:${provider}`, now });
}

function requireEvidence(evidence, predicate, message) {
  if (!evidence.some(predicate)) throw new CielError('INSUFFICIENT_EVIDENCE', message);
}

export function promote(item, toLevel, { evidence = [], now }) {
  if (!(toLevel in EpistemicLevelName)) throw new CielError('INVALID_LEVEL', `unknown level ${toLevel}`);
  if (toLevel <= item.level) throw new CielError('NOT_A_PROMOTION', `${EpistemicLevelName[item.level]} -> ${EpistemicLevelName[toLevel]}`);
  if (item.validity !== Validity.VALID) throw new CielError('INVALID_ITEM', 'cannot promote a stale or invalidated item');
  const trusted = (e) => e.kind === EvidenceKind.OBSERVATION && e.integrity === IntegrityStatus.TRUSTED;
  if (toLevel >= EpistemicLevel.CORROBORATED_INFERENCE && toLevel < EpistemicLevel.OBSERVED_FACT) {
    if (new Set(evidence.map((e) => e.source)).size < 2) {
      throw new CielError('INSUFFICIENT_EVIDENCE', 'CORROBORATED_INFERENCE requires evidence from at least two independent sources');
    }
  }
  if (toLevel >= EpistemicLevel.OBSERVED_FACT) requireEvidence(evidence, trusted, 'OBSERVED_FACT requires a TRUSTED observation');
  if (toLevel === EpistemicLevel.VERIFIED_FACT) {
    requireEvidence(evidence, (e) => e.kind === EvidenceKind.VERIFICATION, 'VERIFIED_FACT requires VERIFICATION evidence');
  }
  return {
    ...item, level: toLevel, kind: kindForLevel(toLevel),
    evidence_ids: [...new Set([...item.evidence_ids, ...evidence.map((e) => e.id)])],
    last_verified: toLevel === EpistemicLevel.VERIFIED_FACT ? now : item.last_verified,
    updated_at: now,
  };
}

export function markStale(item, { reason, now }) {
  return { ...item, validity: Validity.STALE, invalidation_reason: reason, updated_at: now };
}

export function invalidate(item, { reason, now }) {
  return { ...item, validity: Validity.INVALIDATED, invalidation_reason: reason, updated_at: now };
}

// Conflict assessment between claims about the same subject (spec §25).
// claims: [{ value, source, evidence_ids }]. Resolution (freshness/authority/...) is Phase D.
export function assessConflict(claims) {
  if (claims.length < 2) return ConflictState.INSUFFICIENT_EVIDENCE;
  const values = new Set(claims.map((c) => JSON.stringify(c.value)));
  if (values.size === 1) return ConflictState.CONSISTENT;
  if (claims.some((c) => !c.evidence_ids || c.evidence_ids.length === 0)) return ConflictState.INSUFFICIENT_EVIDENCE;
  return ConflictState.CONFLICTED;
}