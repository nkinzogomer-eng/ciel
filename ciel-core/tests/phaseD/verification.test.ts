// Phase D — the 4-verifier catalog, arbitration and strategy selection.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { createVerificationRecord } from '../../domain/verification.ts';
import { arbitrate, resolveConflict, ArbitrationOutcome } from '../../engines/arbitration.ts';
import { selectStrategy, reconsider, assertSunkCostIgnored } from '../../engines/strategySelector.ts';
import { createStrategy, recordStrategyOutcome } from '../../domain/strategy.ts';

suite('Phase D — Verification engine', (test) => {
  test('no applicable verifier means UNVERIFIED, never "probably fine"', async () => {
    const { ciel } = createRig();
    const v = await ciel.verifier.verify({ subject_id: 't1', spec: null, output: { value: 1 } });
    assert.equal(v.state, 'UNVERIFIED');
    assert.equal(v.record.verifier_kind, null);
    assert.ok(v.record.notes.includes('no applicable verifier'));
  });

  test('an unknown verifier kind is not treated as a verifier', async () => {
    const { ciel } = createRig();
    const v = await ciel.verifier.verify({ subject_id: 't1', spec: { kind: 'VIBES' }, output: {} });
    assert.equal(v.state, 'UNVERIFIED');
    assert.equal(v.record.verifier_kind, null);
  });

  test('PREDICATE: satisfied verifies, unsatisfied CONTRADICTS', async () => {
    const { ciel } = createRig();
    const ok = await ciel.verifier.verify({ subject_id: 't1', spec: predicate('value', 'eq', 42), output: { value: 42 } });
    assert.equal(ok.state, 'VERIFIED');
    const bad = await ciel.verifier.verify({ subject_id: 't1', spec: predicate('value', 'eq', 42), output: { value: 7 } });
    assert.equal(bad.state, 'CONTRADICTED');
    assert.equal(bad.record.contradictions.length, 1);
  });

  test('INDEPENDENT_OBSERVATION: agreement verifies, disagreement contradicts', async () => {
    const { ciel, world } = createRig();
    world.set('a', 2);
    const spec = { kind: 'INDEPENDENT_OBSERVATION', capability: 'kv.get', params: { key: 'a' }, compare: { path: 'value' } };
    const ok = await ciel.verifier.verify({ subject_id: 't1', spec, output: { value: 2 }, produced_by: 'kv.set' });
    assert.equal(ok.state, 'VERIFIED');
    const bad = await ciel.verifier.verify({ subject_id: 't1', spec, output: { value: 99 }, produced_by: 'kv.set' });
    assert.equal(bad.state, 'CONTRADICTED');
  });

  test('INDEPENDENT_OBSERVATION refuses to use the capability under verification', async () => {
    const { ciel, world } = createRig();
    world.set('a', 2);
    const v = await ciel.verifier.verify({
      subject_id: 't1', produced_by: 'kv.get',
      spec: { kind: 'INDEPENDENT_OBSERVATION', capability: 'kv.get', params: { key: 'a' }, compare: { path: 'value' } },
      output: { value: 2 },
    });
    assert.equal(v.state, 'UNVERIFIED');
    assert.ok(v.record.notes.includes('not independent'));
  });

  test('INDEPENDENT_OBSERVATION with no available observer stays UNVERIFIED', async () => {
    const { ciel } = createRig();
    const v = await ciel.verifier.verify({
      subject_id: 't1', spec: { kind: 'INDEPENDENT_OBSERVATION', capability: 'satellite.photo', compare: { path: 'value' } }, output: { value: 1 },
    });
    assert.equal(v.state, 'UNVERIFIED');
    assert.ok(v.record.notes.includes('not registered'));
  });

  test('CONSISTENCY needs at least two independent sources, and detects disagreement', async () => {
    const { ciel } = createRig();
    const alone = await ciel.verifier.verify({ subject_id: 't1', spec: { kind: 'CONSISTENCY', path: 'value', against: [] }, output: { value: 3 } });
    assert.equal(alone.state, 'UNVERIFIED');
    const agree = await ciel.verifier.verify({ subject_id: 't1', spec: { kind: 'CONSISTENCY', path: 'value', against: [{ source: 'ledger', value: 3 }] }, output: { value: 3 } });
    assert.equal(agree.state, 'VERIFIED');
    const conflict = await ciel.verifier.verify({ subject_id: 't1', spec: { kind: 'CONSISTENCY', path: 'value', against: [{ source: 'ledger', value: 4 }] }, output: { value: 3 } });
    assert.equal(conflict.state, 'CONTRADICTED');
  });

  test('HUMAN_ATTESTATION waits for the human, then records their verdict', async () => {
    const { ciel } = createRig();
    const spec = { kind: 'HUMAN_ATTESTATION', question: 'Is the invoice correct?' };
    const waiting = await ciel.verifier.verify({ subject_id: 't1', spec, output: {} });
    assert.equal(waiting.needs_human, true);
    assert.equal(waiting.state, 'UNVERIFIED');
    assert.equal(waiting.question, 'Is the invoice correct?');

    const yes = await ciel.verifier.verify({ subject_id: 't1', spec, output: {}, humanAnswer: { confirmed: true, by: 'lea' } });
    assert.equal(yes.state, 'VERIFIED');
    assert.equal(yes.record.performed_by, 'human:lea');

    const no = await ciel.verifier.verify({ subject_id: 't1', spec, output: {}, humanAnswer: { confirmed: false, by: 'lea', note: 'wrong total' } });
    assert.equal(no.state, 'CONTRADICTED');
  });

  test('a model can never be the verifier', () => {
    assert.throws(() => createVerificationRecord({ id: 'v1', subject_id: 't1', subject_type: 'task', performed_by: 'ai:claude', now: 'now' }), 'AI_CANNOT_VERIFY');
  });

  test('a human attestation verifier suspends the mission instead of self-approving', async () => {
    const { ciel, world } = createRig();
    const { mission, tasks } = await ciel.compiler.compile({
      goal: 'needs a human',
      tasks: [{ id: 't1', goal: 't1', action: { capability: 'data.transform', params: { op: 'upper', value: 'ok' } }, verification: { kind: 'HUMAN_ATTESTATION', question: 'Is OK correct?' } }],
    });
    const run1 = await ciel.executor.run(mission.id, { world });
    assert.equal(run1.outcome, 'WAITING_FOR_USER');
    const run2 = await ciel.executor.run(mission.id, { world, humanAnswers: { [tasks[0].id]: { confirmed: true, by: 'lea' } } });
    assert.equal(run2.outcome, 'COMPLETED_VERIFIED');
  });
});

suite('Phase D — Arbitration', (test) => {
  const now = '2026-01-01T00:00:00.000Z';

  test('ranks on independent sources, then epistemic level, then risk', () => {
    const r = arbitrate({
      id: 'd1', mission_id: 'm1', question: 'which route?', now,
      candidates: [
        { option: 'A', risk: 'low', evidence: [{ id: 'e1', source: 's1', level: 4 }, { id: 'e2', source: 's2', level: 4 }] },
        { option: 'B', risk: 'low', evidence: [{ id: 'e3', source: 's1', level: 4 }] },
      ],
    });
    assert.equal(r.outcome, ArbitrationOutcome.DECIDED);
    assert.equal(r.decision.selected, 'A');
    assert.equal(r.decision.made_by, 'ciel:arbitration');
    assert.equal(r.decision.confidence.execution, 0, 'nothing has been executed yet');
  });

  test('refuses to decide without evidence', () => {
    const r = arbitrate({ id: 'd2', mission_id: 'm1', question: 'which?', now, candidates: [{ option: 'A', evidence: [] }, { option: 'B', evidence: [] }] });
    assert.equal(r.outcome, ArbitrationOutcome.INSUFFICIENT_EVIDENCE);
    assert.equal(r.decision, null);
  });

  test('a genuine tie is handed to the user, not broken arbitrarily', () => {
    const r = arbitrate({
      id: 'd3', mission_id: 'm1', question: 'which?', now,
      candidates: [
        { option: 'A', risk: 'low', evidence: [{ source: 's1', level: 3 }] },
        { option: 'B', risk: 'low', evidence: [{ source: 's2', level: 3 }] },
      ],
    });
    assert.equal(r.outcome, ArbitrationOutcome.TIE_NEEDS_USER);
    assert.equal(r.decision, null);
  });

  test('conflict resolution: verification, then sources, then freshness, then honest ambiguity', () => {
    assert.equal(resolveConflict([
      { value: 1, verification_state: 'VERIFIED', sources: 1 },
      { value: 2, verification_state: 'UNVERIFIED', sources: 3 },
    ]).rule, 'verification');
    assert.equal(resolveConflict([{ value: 1, sources: 3 }, { value: 2, sources: 1 }]).rule, 'independent_sources');
    assert.equal(resolveConflict([
      { value: 1, sources: 1, observed_at: '2026-01-02T00:00:00.000Z' },
      { value: 2, sources: 1, observed_at: '2026-01-01T00:00:00.000Z' },
    ]).rule, 'freshness');
    const ambiguous = resolveConflict([{ value: 1, sources: 1 }, { value: 2, sources: 1 }]);
    assert.equal(ambiguous.resolved, null);
    assert.equal(ambiguous.ambiguous, true);
  });
});

suite('Phase D — Strategy selection & sunk cost', (test) => {
  const now = '2026-01-01T00:00:00.000Z';
  const make = (id, applicability, cost) => createStrategy({ id, mission_id: 'm1', objective: 'o', approach: 'a', applicability, cost, now });

  test('only strategies applicable in the current context are considered', () => {
    const s1 = make('s1', { env: 'base44' });
    const s2 = make('s2', { env: 'linux' });
    const r = selectStrategy([s1, s2], { env: 'linux' });
    assert.equal(r.selected.id, 's2');
    assert.equal(r.considered.length, 1);
  });

  test('performance is contextual: success elsewhere does not count here', () => {
    let s1 = make('s1', {}, { time_ms: 10 });
    for (const _ of [1, 2, 3]) s1 = recordStrategyOutcome(s1, { context: { env: 'linux' }, outcome: 'SUCCESS', now });
    const inOther = selectStrategy([s1], { env: 'base44' });
    assert.equal(inOther.considered[0].attempts, 0);
    assert.ok(inOther.considered[0].insufficient_data);
    assert.ok(inOther.reason.includes('enough samples'));
  });

  test('a measured strategy is preferred over an untested one in the same context', () => {
    let measured = make('measured', {}, { time_ms: 100 });
    for (const _ of [1, 2, 3]) measured = recordStrategyOutcome(measured, { context: { env: 'linux' }, outcome: 'SUCCESS', now });
    const untested = make('untested', {}, { time_ms: 1 });
    const r = selectStrategy([measured, untested], { env: 'linux' });
    assert.equal(r.selected.id, 'measured');
    assert.equal(r.considered.find((c) => c.id === 'measured').contextual_success_rate, 1);
  });

  test('no applicable strategy is reported as such', () => {
    const r = selectStrategy([make('s1', { env: 'base44' })], { env: 'linux' });
    assert.equal(r.selected, null);
  });

  test('abandonment requires invalidating evidence and ignores what was already spent', () => {
    const s = make('s1', {});
    assert.equal(reconsider(s, { invalidating_evidence_ids: [], spent: { time_ms: 999999 }, now }).action, 'CONTINUE');
    const cheap = reconsider(s, { invalidating_evidence_ids: ['e1'], spent: { time_ms: 1 }, now });
    const expensive = reconsider(s, { invalidating_evidence_ids: ['e1'], spent: { time_ms: 9999999 }, now });
    assert.equal(cheap.action, 'ABANDON');
    assert.ok(assertSunkCostIgnored(cheap, expensive));
    assert.deepEqual(expensive.strategy.sunk_cost_at_abandon, { time_ms: 9999999 }, 'the spend is recorded, just not used as a criterion');
  });
});