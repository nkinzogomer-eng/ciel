// Phase F — budget enforcement inside the executor, protected operations, loop detection.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { createLoopDetector, LoopKind } from '../../engines/loopDetector.ts';
import { createBudget, consume, assessBudget, operationAllowed } from '../../domain/budget.ts';

const t = (id, capability, params, verification) => ({ id, goal: id, action: { capability, params }, verification });

suite('Phase F — Budget enforcement', (test) => {
  test('the mission stops when the budget is exhausted, and says why', async () => {
    const { ciel, world } = createRig({ limits: { tool_calls: 1 } });
    const { mission } = await ciel.compiler.compile({
      goal: 'two calls, one allowed',
      tasks: [
        t('t1', 'data.transform', { op: 'upper', value: 'a' }, predicate('value', 'eq', 'A')),
        t('t2', 'data.transform', { op: 'upper', value: 'b' }, predicate('value', 'eq', 'B')),
      ],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.outcome, 'BLOCKED');
    assert.equal(report.tasks[0].status, 'VERIFIED');
    assert.equal(report.tasks[1].status, 'PENDING', 'the second task must not run');
    assert.ok(report.mission.status_history.some((h) => h.reason.includes('budget')));
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.budget_assessed, 1);
    assert.equal(summary.by_type.mission_blocked, 1);
  });

  test('verification stays allowed even when the budget says STOP', () => {
    let b = createBudget({ id: 'b1', mission_id: 'm1', limits: { tool_calls: 1 }, now: '2026-01-01T00:00:00.000Z' });
    b = consume(b, { tool_calls: 5 }, '2026-01-01T00:00:00.000Z');
    const a = assessBudget(b, { now: '2026-01-01T00:00:00.000Z' });
    assert.equal(a.decision, 'STOP');
    assert.equal(operationAllowed(a, 'execution'), false);
    assert.equal(operationAllowed(a, 'verification'), true, 'verification is a protected operation');
  });

  test('a generous budget does not interfere', async () => {
    const { ciel, world } = createRig({ limits: { tool_calls: 100 } });
    const { mission } = await ciel.compiler.compile({
      goal: 'fits',
      tasks: [t('t1', 'data.transform', { op: 'upper', value: 'a' }, predicate('value', 'eq', 'A'))],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.outcome, 'COMPLETED_VERIFIED');
    assert.equal(report.budget.used.tool_calls, 1);
  });
});

suite('Phase F — Loop detection', (test) => {
  test('detects the same action producing the same outcome repeatedly', async () => {
    const loop = createLoopDetector({ threshold: 3 });
    await loop.record({ capability: 'c', params: { a: 1 }, outcome: { r: 1 } });
    const second = await loop.record({ capability: 'c', params: { a: 1 }, outcome: { r: 1 } });
    assert.equal(second.looping, false);
    const third = await loop.record({ capability: 'c', params: { a: 1 }, outcome: { r: 1 } });
    assert.equal(third.looping, true);
    assert.equal(third.kind, LoopKind.REPEATED_IDENTICAL);
  });

  test('different outcomes are progress, not a loop', async () => {
    const loop = createLoopDetector({ threshold: 3 });
    for (const r of [1, 2, 3, 4]) {
      const a = await loop.record({ capability: 'c', params: { a: 1 }, outcome: { r } });
      assert.equal(a.looping, false);
    }
  });

  test('detects oscillation between two outcomes', async () => {
    const loop = createLoopDetector({ threshold: 99 });
    let last;
    for (const r of [1, 2, 1, 2]) last = await loop.record({ capability: 'c', params: { a: 1 }, outcome: { r } });
    assert.equal(last.looping, true);
    assert.equal(last.kind, LoopKind.OSCILLATION);
  });

  test('the executor stops a mission that is repeating itself', async () => {
    const { ciel, world } = createRig();
    const params = { op: 'upper', value: 'x' };
    const { mission } = await ciel.compiler.compile({
      goal: 'repeat the same action',
      tasks: [
        t('t1', 'data.transform', params, predicate('value', 'eq', 'X')),
        t('t2', 'data.transform', params, predicate('value', 'eq', 'X')),
        t('t3', 'data.transform', params, predicate('value', 'eq', 'X')),
      ],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.outcome, 'BLOCKED');
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.loop_detected, 1);
    assert.ok(report.mission.status_history.some((h) => h.reason.includes('loop detected')));
  });
});