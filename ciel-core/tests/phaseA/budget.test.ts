import { suite, assert } from '../runner.ts';
import { BudgetDecision, VerificationState } from '../../core/types.ts';
import { createBudget, consume, utilization, assessBudget, operationAllowed, UNTRACKED_DIMENSIONS } from '../../domain/budget.ts';
import { createExperience, createPrediction, resolvePrediction, calibration, MIN_CALIBRATION_SAMPLES } from '../../domain/experience.ts';
import { fingerprint, fingerprintMatches, canonicalize, deepEqual } from '../../core/fingerprint.ts';
import { fixedClock } from '../../core/clock.ts';

const clock = fixedClock('2026-01-01T00:00:00.000Z');
const now = clock.now();

suite('Phase A · Budget, experience calibration, fingerprints', (test) => {
  test('unknown budget dimensions are refused; CPU and RAM are declared untracked', () => {
    assert.throws(() => createBudget({ id: 'b', mission_id: 'm', limits: { cpu: 10 }, now }), 'UNKNOWN_DIMENSION');
    assert.deepEqual([...UNTRACKED_DIMENSIONS], ['cpu', 'ram']);
    const b = createBudget({ id: 'b', mission_id: 'm', limits: { tool_calls: 10 }, now });
    assert.throws(() => consume(b, { ram: 1 }, now), 'UNKNOWN_DIMENSION');
    assert.throws(() => consume(b, { tokens: -1 }, now), 'INVALID_USAGE');
  });

  test('utilization is null for unlimited dimensions and a ratio for limited ones', () => {
    const b = consume(createBudget({ id: 'b', mission_id: 'm', limits: { tool_calls: 10 }, now }), { tool_calls: 4, tokens: 999 }, now);
    const u = utilization(b);
    assert.equal(u.tool_calls, 0.4);
    assert.equal(u.tokens, null);
  });

  test('crossing the soft threshold reduces scope; exhaustion stops the mission', () => {
    const b = createBudget({ id: 'b', mission_id: 'm', limits: { tool_calls: 10 }, now });
    assert.equal(assessBudget(consume(b, { tool_calls: 5 }, now), { now }).decision, BudgetDecision.CONTINUE);
    assert.equal(assessBudget(consume(b, { tool_calls: 8 }, now), { now }).decision, BudgetDecision.REDUCE_SCOPE);
    const dead = assessBudget(consume(b, { tool_calls: 10 }, now), { now });
    assert.equal(dead.decision, BudgetDecision.STOP);
    assert.ok(dead.reasons.some((r) => r.includes('exhausted')));
  });

  test('a passed deadline stops the mission even with budget left', () => {
    const b = createBudget({ id: 'b', mission_id: 'm', limits: { tool_calls: 100 }, deadline: '2025-12-31T00:00:00.000Z', now });
    const a = assessBudget(b, { now });
    assert.equal(a.decision, BudgetDecision.STOP);
    assert.ok(a.reasons.includes('deadline reached'));
  });

  test('verification is never sacrificed to save budget', () => {
    const b = consume(createBudget({ id: 'b', mission_id: 'm', limits: { tool_calls: 1 }, now }), { tool_calls: 5 }, now);
    const a = assessBudget(b, { now });
    assert.equal(a.decision, BudgetDecision.STOP);
    assert.equal(operationAllowed(a, 'verification'), true);
    assert.equal(operationAllowed(a, 'tool_call'), false);
  });

  test('an experience without applicability conditions is refused (no universal laws)', () => {
    assert.throws(() => createExperience({ id: 'x', mission_id: 'm', context: {}, goal: 'g', result: 'ok', now }), 'APPLICABILITY_REQUIRED');
    assert.throws(() => createExperience({ id: 'x', mission_id: 'm', context: {}, goal: 'g', applicability: { os: 'linux' }, now }), 'RESULT_REQUIRED');
    const e = createExperience({ id: 'x', mission_id: 'm', context: { os: 'linux' }, goal: 'g', result: 'ok', applicability: { os: 'linux' }, lesson: 'prefer x', now });
    assert.equal(e.applicability.os, 'linux');
  });

  test('only VERIFIED outcomes resolve a prediction into a hit or a miss', () => {
    const p = createPrediction({ id: 'p1', subject_id: 't1', subject_type: 'task', predictor: 'ciel:heuristic', task_class: 'compute', prediction: { value: 4 }, confidence: 0.8, now });
    assert.equal(resolvePrediction(p, { actual_outcome: { value: 4 }, verification_state: VerificationState.UNVERIFIED, now }).hit, null);
    assert.equal(resolvePrediction(p, { actual_outcome: { value: 4 }, verification_state: VerificationState.VERIFIED, now }).hit, true);
    assert.equal(resolvePrediction(p, { actual_outcome: { value: 5 }, verification_state: VerificationState.VERIFIED, now }).hit, false);
    assert.throws(() => createPrediction({ id: 'p', subject_id: 's', predictor: 'x', task_class: 'c', confidence: 1.5, now }), 'OUT_OF_RANGE');
  });

  test('calibration is per predictor and task class, and says when data is insufficient', () => {
    const mk = (i, task_class, hitVal, confidence) => resolvePrediction(
      createPrediction({ id: `p${task_class}${i}`, subject_id: 's', subject_type: 'task', predictor: 'ai:x', task_class, prediction: { v: 1 }, confidence, now }),
      { actual_outcome: { v: hitVal ? 1 : 2 }, verification_state: VerificationState.VERIFIED, now },
    );
    const preds = [
      ...Array.from({ length: 6 }, (_, i) => mk(i, 'compute', i < 3, 0.9)),
      mk(0, 'shell', true, 0.5),
    ];
    const cal = calibration(preds);
    assert.equal(cal['ai:x|compute'].count, 6);
    assert.equal(cal['ai:x|compute'].hit_rate, 0.5);
    assert.equal(cal['ai:x|compute'].gap, 0.4); // overconfident in this class only
    assert.equal(cal['ai:x|compute'].insufficient_data, false);
    assert.equal(cal['ai:x|shell'].insufficient_data, true);
    assert.equal(MIN_CALIBRATION_SAMPLES, 5);
    // Unresolved predictions never enter calibration.
    assert.deepEqual(calibration([createPrediction({ id: 'p', subject_id: 's', predictor: 'ai:x', task_class: 'compute', prediction: 1, confidence: 0.9, now })]), {});
  });

  test('fingerprints are order-independent, change with the observed value, and ignore undefined', async () => {
    const a = await fingerprint({ b: 1, a: [1, 2], nested: { y: 2, x: 1 } });
    const b = await fingerprint({ nested: { x: 1, y: 2 }, a: [1, 2], b: 1 });
    assert.equal(a, b);
    assert.ok(a.startsWith('sha256:'));
    assert.ok(await fingerprintMatches(a, { a: [1, 2], b: 1, nested: { x: 1, y: 2 }, extra: undefined }));
    assert.ok(!(await fingerprintMatches(a, { a: [2, 1], b: 1, nested: { x: 1, y: 2 } })), 'array order is significant');
    assert.ok(!(await fingerprintMatches(a, { a: [1, 2], b: 2, nested: { x: 1, y: 2 } })));
    assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
    assert.ok(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 }));
  });
});