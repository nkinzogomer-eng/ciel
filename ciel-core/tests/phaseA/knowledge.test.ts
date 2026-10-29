import { suite, assert } from '../runner.ts';
import { EpistemicLevel, KnowledgeKind, EvidenceKind, IntegrityStatus, ConflictState } from '../../core/types.ts';
import { createKnowledgeItem, fromExternalClaim, promote, invalidate, assessConflict } from '../../domain/knowledge.ts';
import { createEvidence, createObservation, assessIntegrity, observationToEvidence } from '../../domain/evidence.ts';
import { fixedClock } from '../../core/clock.ts';

const now = fixedClock().now();
const obsEvidence = (id, source = 'capability:a') => createEvidence({ id, kind: EvidenceKind.OBSERVATION, source, content: 1, integrity: IntegrityStatus.TRUSTED, now });
const verEvidence = (id) => createEvidence({ id, kind: EvidenceKind.VERIFICATION, source: 'ciel:predicate_verifier', content: true, now });

suite('Phase A · Knowledge model: claims ≠ evidence ≠ verification', (test) => {
  test('an AI answer enters as a HYPOTHESIS with an ai: source', () => {
    const h = fromExternalClaim({ id: 'k1', statement: 'The bug is in module X', provider: 'anthropic', now });
    assert.equal(h.kind, KnowledgeKind.HYPOTHESIS);
    assert.equal(h.level, EpistemicLevel.HYPOTHESIS);
    assert.equal(h.source, 'ai:anthropic');
  });

  test('kind and level must agree (a HYPOTHESIS cannot carry a FACT level)', () => {
    assert.throws(() => createKnowledgeItem({ id: 'k', kind: KnowledgeKind.HYPOTHESIS, statement: 's', level: EpistemicLevel.VERIFIED_FACT, now }), 'LEVEL_KIND_MISMATCH');
  });

  test('promotion to VERIFIED_FACT is refused without VERIFICATION evidence', () => {
    const h = fromExternalClaim({ id: 'k1', statement: 's', provider: 'p', now });
    assert.throws(() => promote(h, EpistemicLevel.VERIFIED_FACT, { evidence: [obsEvidence('e1')], now }), 'INSUFFICIENT_EVIDENCE');
    const f = promote(h, EpistemicLevel.VERIFIED_FACT, { evidence: [obsEvidence('e1'), verEvidence('e2')], now });
    assert.equal(f.kind, KnowledgeKind.FACT);
    assert.equal(f.last_verified, now);
  });

  test('OBSERVED_FACT requires a TRUSTED observation; SUSPECT is not enough', () => {
    const h = fromExternalClaim({ id: 'k1', statement: 's', provider: 'p', now });
    const suspect = { ...obsEvidence('e1'), integrity: IntegrityStatus.SUSPECT };
    assert.throws(() => promote(h, EpistemicLevel.OBSERVED_FACT, { evidence: [suspect], now }), 'INSUFFICIENT_EVIDENCE');
  });

  test('CORROBORATED_INFERENCE requires two independent sources', () => {
    const inf = createKnowledgeItem({ id: 'k', kind: KnowledgeKind.INFERENCE, statement: 's', level: EpistemicLevel.INFERENCE, now });
    assert.throws(() => promote(inf, EpistemicLevel.CORROBORATED_INFERENCE, { evidence: [obsEvidence('e1', 'a'), obsEvidence('e2', 'a')], now }), 'INSUFFICIENT_EVIDENCE');
    promote(inf, EpistemicLevel.CORROBORATED_INFERENCE, { evidence: [obsEvidence('e1', 'a'), obsEvidence('e2', 'b')], now });
  });

  test('an invalidated item cannot be promoted', () => {
    const h = invalidate(fromExternalClaim({ id: 'k1', statement: 's', provider: 'p', now }), { reason: 'repo changed', now });
    assert.throws(() => promote(h, EpistemicLevel.INFERENCE, { now }), 'INVALID_ITEM');
  });

  test('tool output must be integrity-assessed before it becomes evidence (§26)', () => {
    const obs = createObservation({ id: 'o1', task_id: 't1', capability: 'compute', output: { value: 4 }, now });
    assert.throws(() => observationToEvidence(obs, { id: 'e1', now }), 'INTEGRITY_UNASSESSED');
    const trusted = assessIntegrity(obs, [{ name: 'schema', passed: true }, { name: 'exit_code', passed: true }]);
    assert.equal(trusted.integrity.status, IntegrityStatus.TRUSTED);
    const ev = observationToEvidence(trusted, { id: 'e1', now });
    assert.equal(ev.kind, EvidenceKind.OBSERVATION);
    assert.equal(assessIntegrity(obs, [{ name: 'schema', passed: false }]).integrity.status, IntegrityStatus.SUSPECT);
  });

  test('conflicting sources yield CONFLICTED, not a forced resolution', () => {
    assert.equal(assessConflict([{ value: 1, evidence_ids: ['a'] }, { value: 1, evidence_ids: ['b'] }]), ConflictState.CONSISTENT);
    assert.equal(assessConflict([{ value: 1, evidence_ids: ['a'] }, { value: 2, evidence_ids: ['b'] }]), ConflictState.CONFLICTED);
    assert.equal(assessConflict([{ value: 1, evidence_ids: ['a'] }, { value: 2, evidence_ids: [] }]), ConflictState.INSUFFICIENT_EVIDENCE);
    assert.equal(assessConflict([{ value: 1, evidence_ids: ['a'] }]), ConflictState.INSUFFICIENT_EVIDENCE);
  });
});