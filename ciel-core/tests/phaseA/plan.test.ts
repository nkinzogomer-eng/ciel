import { suite, assert } from '../runner.ts';
import { validatePlan, topologicalOrder, instantiatePlan } from '../../domain/plan.ts';
import { sequentialIds } from '../../core/ids.ts';
import { fixedClock } from '../../core/clock.ts';

const now = fixedClock().now();

const goodPlan = {
  goal: 'Compute and verify a sum',
  tasks: [
    { id: 'sum', action: { capability: 'compute.arithmetic', params: { expr: '2+2' } }, success_conditions: [{ path: 'output.value', op: 'eq', value: 4 }] },
    { id: 'record', action: { capability: 'ciel.record_fact' }, dependencies: ['sum'] },
    { id: 'report', action: { capability: 'ciel.report' }, dependencies: ['sum', 'record'] },
  ],
};

suite('Phase A · Structured Mission Plan (no AI required)', (test) => {
  test('a valid plan passes validation', () => {
    assert.deepEqual(validatePlan(goodPlan), { ok: true, errors: [] });
  });

  test('missing goal, duplicate ids, unknown and self dependencies are reported', () => {
    const v = validatePlan({ tasks: [
      { id: 'a', action: { capability: 'x' }, dependencies: ['a', 'zzz'] },
      { id: 'a', action: {} },
    ] });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('goal')));
    assert.ok(v.errors.some((e) => e.includes('duplicated')));
    assert.ok(v.errors.some((e) => e.includes('depends on itself')));
    assert.ok(v.errors.some((e) => e.includes('unknown task "zzz"')));
    assert.ok(v.errors.some((e) => e.includes('action.capability')));
  });

  test('dependency cycles are detected', () => {
    const cyclic = { goal: 'g', tasks: [
      { id: 'a', action: { capability: 'x' }, dependencies: ['c'] },
      { id: 'b', action: { capability: 'x' }, dependencies: ['a'] },
      { id: 'c', action: { capability: 'x' }, dependencies: ['b'] },
    ] };
    assert.equal(validatePlan(cyclic).ok, false);
    assert.throws(() => topologicalOrder(cyclic.tasks), 'PLAN_CYCLE');
  });

  test('topological order respects dependencies', () => {
    const order = topologicalOrder(goodPlan.tasks);
    assert.ok(order.indexOf('sum') < order.indexOf('record'));
    assert.ok(order.indexOf('record') < order.indexOf('report'));
  });

  test('instantiatePlan produces a mission and tasks with remapped dependencies', () => {
    const { mission, tasks, plan_task_ids } = instantiatePlan(goodPlan, { missionId: 'm1', newId: sequentialIds('task'), now });
    assert.equal(mission.goal, goodPlan.goal);
    assert.equal(tasks.length, 3);
    const report = tasks.find((t) => t.id === plan_task_ids.report);
    assert.deepEqual(report.dependencies.sort(), [plan_task_ids.sum, plan_task_ids.record].sort());
    assert.equal(tasks[0].status, 'PENDING');
  });

  test('instantiatePlan refuses an invalid plan', () => {
    assert.throws(() => instantiatePlan({ goal: 'g', tasks: [] }, { missionId: 'm', newId: sequentialIds(), now }), 'INVALID_PLAN');
  });
});