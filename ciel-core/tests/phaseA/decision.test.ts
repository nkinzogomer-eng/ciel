import { suite, assert } from '../runner.ts';
import { DecisionType, DecisionValidity, VerificationState, VerifierKind } from '../../core/types.ts';
import { createDecision, validateDecision, invalidateDecision, supersedeDecision } from '../../domain/decision.ts';
import { createConfidence, overallConfidence, fromExternalClaim } from '../../domain/confidence.ts';
import { createVerificationRecord, resolveVerificationState, applicableVerifier } from '../../domain/verification.ts';
import { createStrategy, recordStrategyOutcome, performanceIn, applicabilityMatches, abandonStrategy } from '../../domain/strategy.ts';
import { fixedClock } from '../../core/clock.ts';

const now = fixedClock().now();
const base = { mission_id: 'm1', question: 'which approach?', options: ['a', 'b'], selected: 'a', now };

suite('Phase A · Decision primitive, confidence, verification rule, strategy', (test) => {
  test('a decision made by Ciel is VALID; the same decision proposed by an AI is UNCERTAIN and must be verified', () => {
    const own = createDecision({ id: 'd1', type: DecisionType.CHOICE, ...base });
    assert.equal(own.validity, DecisionValidity.VALID);
    assert.equal(own.verification_required, false);
    const ai = createDecision({ id: 'd2', type: DecisionType.CHOICE, made_by: 'ai:anthropic', ...base });
    assert.equal(ai.validity, DecisionValidity.UNCERTAIN);
    assert.equal(ai.verification_required, true);
    assert.equal(validateDecision(ai, { now }).validity, DecisionValidity.VALID);
  });

  test('selection is type-checked per decision type', () => {
    assert.throws(() => createDecision({ id: 'd', type: DecisionType.CHOICE, ...base, selected: 'zzz' }), 'INVALID_SELECTION');
    assert.throws(() => createDecision({ id: 'd', type: DecisionType.BOOLEAN, ...base, selected: 'yes' }), 'INVALID_SELECTION');
    assert.throws(() => createDecision({ id: 'd', type: DecisionType.PROBABILITY, ...base, selected: 1.5 }), 'OUT_OF_RANGE');
    createDecision({ id: 'd', type: DecisionType.RANK, ...base, selected: ['b', 'a'] });
  });

  test('a decision must record the question it answers', () => {
    assert.throws(() => createDecision({ id: 'd', type: DecisionType.BOOLEAN, mission_id: 'm1', selected: true, now }), 'MISSING_QUESTION');
  });

  test('invalidated and superseded decisions keep their history', () => {
    const d = createDecision({ id: 'd1', type: DecisionType.BOOLEAN, ...base, selected: true });
    assert.equal(invalidateDecision(d, { reason: 'new evidence', now }).invalidation_reason, 'new evidence');
    const s = supersedeDecision(d, { by: 'd2', now });
    assert.equal(s.validity, DecisionValidity.SUPERSEDED);
    assert.equal(s.superseded_by, 'd2');
    assert.throws(() => validateDecision(s, { now }), 'SUPERSEDED');
  });

  test('confidence has 4 dimensions, overall is the weakest link, and model confidence stays a claim', () => {
    const c = createConfidence({ knowledge: 0.9, evidence: 0.2, reasoning: 0.8, execution: 1 });
    assert.equal(overallConfidence(c), 0.2);
    assert.throws(() => createConfidence({ knowledge: 1.2 }), 'OUT_OF_RANGE');
    const ext = fromExternalClaim({ reasoning: 0.95, knowledge: 0.9 });
    assert.equal(overallConfidence(ext), 0);
    assert.equal(ext.claimed.reasoning, 0.95);
  });

  test('no applicable verifier means never VERIFIED (absolute rule)', () => {
    assert.equal(applicableVerifier(null), null);
    assert.equal(applicableVerifier({ kind: 'MAGIC' }), null);
    assert.equal(applicableVerifier({ kind: VerifierKind.PREDICATE }), VerifierKind.PREDICATE);
    assert.equal(resolveVerificationState({ verifier_kind: null, required: ['r1'], satisfied: ['r1'] }), VerificationState.UNVERIFIED);
    assert.equal(resolveVerificationState({ verifier_kind: VerifierKind.PREDICATE, required: ['r1'], satisfied: ['r1'] }), VerificationState.VERIFIED);
    assert.equal(resolveVerificationState({ verifier_kind: VerifierKind.PREDICATE, required: ['r1', 'r2'], satisfied: ['r1'] }), VerificationState.PARTIALLY_VERIFIED);
    assert.equal(resolveVerificationState({ verifier_kind: VerifierKind.PREDICATE, required: ['r1'], satisfied: [], contradictions: ['c'] }), VerificationState.CONTRADICTED);
    assert.equal(resolveVerificationState({ verifier_kind: VerifierKind.PREDICATE, required: [], satisfied: [] }), VerificationState.UNKNOWN);
  });

  test('a model cannot author a verification record', () => {
    assert.throws(() => createVerificationRecord({ id: 'v', subject_id: 't', subject_type: 'task', performed_by: 'ai:anthropic', now }), 'AI_CANNOT_VERIFY');
    const r = createVerificationRecord({ id: 'v', subject_id: 't', subject_type: 'task', verifier_kind: VerifierKind.PREDICATE, required_evidence: ['a', 'b'], satisfied_evidence: ['a'], now });
    assert.deepEqual(r.unverified, ['b']);
    assert.equal(r.state, VerificationState.PARTIALLY_VERIFIED);
  });

  test('strategy performance is contextual and abandonment ignores sunk cost', () => {
    let s = createStrategy({ id: 's1', mission_id: 'm1', objective: 'o', approach: 'a', applicability: { os: ['linux', 'mac'] }, now });
    assert.ok(applicabilityMatches(s, { os: 'linux' }));
    assert.ok(!applicabilityMatches(s, { os: 'windows' }));
    assert.throws(() => recordStrategyOutcome(s, { context: {}, outcome: 'SUCCESS', now }), 'CONTEXT_REQUIRED');
    s = recordStrategyOutcome(s, { context: { os: 'linux' }, outcome: 'SUCCESS', now });
    s = recordStrategyOutcome(s, { context: { os: 'windows' }, outcome: 'FAILURE', now });
    assert.deepEqual(performanceIn(s, { os: 'linux' }), { attempts: 1, successes: 1, insufficient_data: true });
    assert.throws(() => abandonStrategy(s, { reason: 'bad feeling', now }), 'EVIDENCE_REQUIRED');
    const ab = abandonStrategy(s, { reason: 'contradicted', evidence_ids: ['e9'], spent: { tokens: 50000 }, now });
    assert.equal(ab.status, 'ABANDONED');
    assert.equal(ab.sunk_cost_at_abandon.tokens, 50000);
  });
});