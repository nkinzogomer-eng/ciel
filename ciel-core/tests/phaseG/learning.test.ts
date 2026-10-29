// Phase G — experience recording, calibration on verified outcomes only, honest self-model.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { COMPONENT_STATUS } from '../../status.ts';

const t = (id, capability, params, verification) => ({ id, goal: id, action: { capability, params }, verification });

suite('Phase G — Experience learning', (test) => {
  test('every executed task leaves an experience with its conditions of validity', async () => {
    const { ciel, world, store } = createRig();
    const { mission } = await ciel.compiler.compile({
      goal: 'learn',
      tasks: [t('t1', 'kv.set', { key: 'a', value: 1 }, predicate('value', 'eq', 1))],
    });
    await ciel.executor.run(mission.id, { world });
    const [exp] = await store.find('experiences', {});
    assert.equal(exp.applicability.capability, 'kv.set');
    assert.equal(exp.result.verification_state, 'VERIFIED');
    assert.ok(exp.lesson.includes('kv.set'));
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.experience_recorded, 1);
  });

  test('a failure is recorded as a failure, not smoothed over', async () => {
    const { ciel, world, store } = createRig();
    const { mission } = await ciel.compiler.compile({ goal: 'fail', tasks: [t('t1', 'always.fails', {}, null)] });
    await ciel.executor.run(mission.id, { world });
    const experiences = await store.find('experiences', {});
    assert.equal(experiences.length, 0, 'a failed execution produces no verified experience to learn from');
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.diagnostic_recorded, 1);
  });

  test('only verified outcomes count in calibration', async () => {
    const { ciel } = createRig();
    const p1 = await ciel.learning.predict({ subject_id: 't1', predictor: 'ciel:rules', task_class: 'transform', prediction: { value: 'X' }, confidence: 0.9 });
    const r1 = await ciel.learning.resolve(p1.id, { actual_outcome: { value: 'X' }, verification_state: 'UNVERIFIED' });
    assert.equal(r1.hit, null, 'an unverified outcome cannot teach Ciel whether it was right');

    const p2 = await ciel.learning.predict({ subject_id: 't2', predictor: 'ciel:rules', task_class: 'transform', prediction: { value: 'X' }, confidence: 0.9 });
    const r2 = await ciel.learning.resolve(p2.id, { actual_outcome: { value: 'X' }, verification_state: 'VERIFIED' });
    assert.equal(r2.hit, true);

    const report = await ciel.learning.calibrationReport();
    assert.equal(report['ciel:rules|transform'].count, 1, 'only the verified prediction is counted');
  });

  test('calibration is per predictor and task class, and flags insufficient data', async () => {
    const { ciel } = createRig();
    for (const [i, outcome] of [['a', true], ['b', true], ['c', false]].entries()) {
      const p = await ciel.learning.predict({ subject_id: `t${i}`, predictor: 'ciel:rules', task_class: 'kv', prediction: { ok: true }, confidence: 0.8 });
      await ciel.learning.resolve(p.id, { actual_outcome: { ok: outcome[1] }, verification_state: 'VERIFIED' });
    }
    const report = await ciel.learning.calibrationReport();
    const g = report['ciel:rules|kv'];
    assert.equal(g.count, 3);
    assert.equal(g.hit_rate, 2 / 3);
    assert.ok(g.gap > 0, 'confidence above hit rate means overconfident');
    assert.equal(g.insufficient_data, true, 'fewer than 5 samples must be flagged');
  });
});

suite('Phase G — Self-model honesty', (test) => {
  test('reports what it can do, with measured rates only where measured', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({
      goal: 'measure',
      tasks: [t('t1', 'kv.set', { key: 'a', value: 1 }, predicate('value', 'eq', 1))],
    });
    await ciel.executor.run(mission.id, { world });
    const model = await ciel.learning.selfModel({ registry: ciel.registry, componentStatus: COMPONENT_STATUS });

    assert.ok(model.can.includes('kv.set'));
    const kvSet = model.capabilities.find((c) => c.capability === 'kv.set');
    assert.equal(kvSet.attempts, 1);
    assert.equal(kvSet.measured_success_rate, 1);
    assert.equal(kvSet.insufficient_data, true, '1 sample is not a track record');

    const untouched = model.capabilities.find((c) => c.capability === 'mail.send');
    assert.equal(untouched.measured_success_rate, null, 'no data means null, never an optimistic guess');
  });

  test('states plainly what it cannot do', async () => {
    const { ciel } = createRig();
    const model = await ciel.learning.selfModel({ registry: ciel.registry, componentStatus: COMPONENT_STATUS });
    assert.ok(model.cannot.length > 0);
    assert.ok(model.cannot.every((c) => c.status === 'NOT_IMPLEMENTED' || c.status === 'REQUIRES_EXTERNAL_RUNTIME'));
    assert.ok(model.cannot.some((c) => c.component.includes('Shell')), 'shell/filesystem access is not available in this runtime');
    assert.equal(model.can.includes('shell.exec'), false);
  });

  test('capability properties are reported from the manifest, not assumed', async () => {
    const { ciel } = createRig();
    const model = await ciel.learning.selfModel({ registry: ciel.registry, componentStatus: [] });
    const counter = model.capabilities.find((c) => c.capability === 'counter.increment');
    assert.equal(counter.idempotent, false);
    const mail = model.capabilities.find((c) => c.capability === 'mail.send');
    assert.equal(mail.reversible, false);
    assert.deepEqual(mail.requires_permissions, ['email:send']);
  });
});