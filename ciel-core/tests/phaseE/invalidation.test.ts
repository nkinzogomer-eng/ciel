// Phase E — precondition re-checking and the invalidation cascade.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { fingerprint } from '../../core/fingerprint.ts';
import { recordPreconditions, checkPreconditions, invalidationClosure, applyInvalidation } from '../../engines/invalidation.ts';
import { createKnowledgeItem } from '../../domain/knowledge.ts';
import { createDecision } from '../../domain/decision.ts';

const now = '2026-01-01T00:00:00.000Z';

suite('Phase E — Preconditions', (test) => {
  test('unchanged state passes, changed state fails with the reason', async () => {
    const { world } = createRig({ initialWorld: { a: 1 } });
    const observe = (key) => world.observe(key);
    const pcs = await recordPreconditions(['kv:a'], observe);
    assert.ok((await checkPreconditions(pcs, observe)).ok);
    world.set('a', 2);
    const after = await checkPreconditions(pcs, observe);
    assert.equal(after.ok, false);
    assert.equal(after.failed[0].reason, 'state fingerprint changed');
  });

  test('predicate preconditions are supported', async () => {
    const { world } = createRig({ initialWorld: { a: 5 } });
    const observe = (key) => world.observe(key);
    assert.ok((await checkPreconditions([{ key: 'kv:a', op: 'gte', value: 5 }], observe)).ok);
    assert.equal((await checkPreconditions([{ key: 'kv:a', op: 'gt', value: 5 }], observe)).ok, false);
  });

  test('a precondition without a fingerprint or an operator is rejected', async () => {
    const { world } = createRig();
    await assert.rejects(() => checkPreconditions([{ key: 'kv:a' }], (k) => world.observe(k)), 'INVALID_PRECONDITION');
  });

  test('the executor refuses to act on stale preconditions', async () => {
    const { ciel, world } = createRig({ initialWorld: { a: 1 } });
    const staleFingerprint = await fingerprint(1);
    world.set('a', 2); // the world moved after the plan was written
    const { mission } = await ciel.compiler.compile({
      goal: 'act on stale state',
      tasks: [{
        id: 't1', goal: 't1', action: { capability: 'kv.set', params: { key: 'b', value: 9 } },
        preconditions: [{ key: 'kv:a', fingerprint: staleFingerprint }],
        verification: predicate('value', 'eq', 9),
      }],
    });
    const report = await ciel.executor.run(mission.id, { world, observe: (k) => world.observe(k) });
    assert.equal(report.tasks[0].status, 'BLOCKED');
    assert.equal(world.has('b'), false, 'the action must not run when its preconditions no longer hold');
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.state_invalidated, 1);
  });
});

suite('Phase E — Invalidation cascade', (test) => {
  test('invalidation is transitive', () => {
    const items = [
      { id: 'k1', dependencies: ['kv:a'] },
      { id: 'k2', dependencies: ['k1'] },
      { id: 'k3', dependencies: ['k2'] },
      { id: 'k4', dependencies: ['kv:other'] },
    ];
    const ids = invalidationClosure(items, ['kv:a']);
    assert.deepEqual(ids.sort(), ['k1', 'k2', 'k3']);
  });

  test('knowledge becomes STALE and decisions become INVALID', () => {
    const k = createKnowledgeItem({ id: 'k1', kind: 'FACT', statement: 'a = 1', level: 4, source: 'obs', dependencies: ['kv:a'], now });
    const d = createDecision({ id: 'd1', mission_id: 'm1', type: 'BOOLEAN', question: 'proceed?', selected: true, dependencies: ['k1'], now });
    const { invalidated_ids, items } = applyInvalidation([k, d], ['kv:a'], { reason: 'a changed', now });
    assert.deepEqual(invalidated_ids.sort(), ['d1', 'k1']);
    assert.equal(items.find((i) => i.id === 'k1').validity, 'STALE');
    assert.equal(items.find((i) => i.id === 'd1').validity, 'INVALID');
  });

  test('a side-effecting action invalidates what depended on the state it changed', async () => {
    const { ciel, store, world } = createRig();
    const knowledge = createKnowledgeItem({ id: 'k_a', kind: 'FACT', statement: 'a = 1', level: 4, source: 'observation', dependencies: ['kv:a'], now });
    await store.put('knowledge', knowledge);
    const { mission } = await ciel.compiler.compile({
      goal: 'change a',
      tasks: [{ id: 't1', goal: 't1', action: { capability: 'kv.set', params: { key: 'a', value: 42 } }, verification: predicate('value', 'eq', 42) }],
    });
    await ciel.executor.run(mission.id, { world });
    const after = await store.get('knowledge', 'k_a');
    assert.equal(after.validity, 'STALE');
    assert.ok(after.invalidation_reason.includes('kv:a'));
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.state_invalidated, 1);
  });

  test('a pure action invalidates nothing', async () => {
    const { ciel, store, world } = createRig();
    await store.put('knowledge', createKnowledgeItem({ id: 'k_a', kind: 'FACT', statement: 'a = 1', level: 4, source: 'observation', dependencies: ['kv:a'], now }));
    const { mission } = await ciel.compiler.compile({
      goal: 'pure',
      tasks: [{ id: 't1', goal: 't1', action: { capability: 'data.transform', params: { op: 'upper', value: 'x' } }, verification: predicate('value', 'eq', 'X') }],
    });
    await ciel.executor.run(mission.id, { world });
    assert.equal((await store.get('knowledge', 'k_a')).validity, 'VALID');
  });
});