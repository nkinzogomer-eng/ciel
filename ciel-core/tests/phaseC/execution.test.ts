// Phase C — Mission Compiler + deterministic executor, end to end, with AI disabled.
import { suite, assert } from '../runner.ts';
import { createRig, restart, predicate } from '../helpers/rig.ts';

const task = (id, capability, params, extra = {}) => ({ id, goal: id, action: { capability, params }, ...extra });

suite('Phase C — Mission Compiler', (test) => {
  test('refuses a plan requiring a capability that does not exist', async () => {
    const { ciel } = createRig();
    const err = await assert.rejects(
      () => ciel.compiler.compile({ goal: 'g', tasks: [task('t1', 'shell.exec', { cmd: 'ls' })] }),
      'UNKNOWN_CAPABILITY',
    );
    assert.ok(err.message.includes('shell.exec'));
  });

  test('refuses an invalid plan before touching the store', async () => {
    const { ciel, store } = createRig();
    await assert.rejects(() => ciel.compiler.compile({ goal: '', tasks: [] }), 'INVALID_PLAN');
    assert.equal(store.counts().missions, 0);
  });

  test('compiles to COMPILED with a budget, a ledger trail and an execution order', async () => {
    const { ciel } = createRig();
    const { mission, tasks, budget, warnings } = await ciel.compiler.compile({
      goal: 'two steps',
      tasks: [task('t1', 'kv.set', { key: 'a', value: 1 }), task('t2', 'kv.get', { key: 'a' }, { dependencies: ['t1'] })],
    });
    assert.equal(mission.status, 'COMPILED');
    assert.equal(tasks.length, 2);
    assert.equal(budget.mission_id, mission.id);
    assert.deepEqual(warnings, []);
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.mission_created, 1);
    assert.equal(summary.by_type.mission_compiled, 1);
  });

  test('reports a missing permission at compile time without faking a failure', async () => {
    const { ciel } = createRig({ permissions: [] });
    const { warnings, mission } = await ciel.compiler.compile({ goal: 'write', tasks: [task('t1', 'kv.set', { key: 'a', value: 1 })] });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'PERMISSION_DENIED');
    assert.equal(mission.status, 'COMPILED', 'the mission still compiles; the task is blocked at execution');
  });
});

suite('Phase C — Deterministic execution', (test) => {
  test('executes a dependency chain in topological order and verifies every result', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({
      goal: 'chain',
      tasks: [
        task('t1', 'kv.set', { key: 'a', value: 2 }, { verification: predicate('value', 'eq', 2) }),
        task('t2', 'kv.get', { key: 'a' }, { dependencies: ['t1'], verification: predicate('value', 'eq', 2) }),
        task('t3', 'data.transform', { op: 'upper', value: 'ok' }, { dependencies: ['t2'], verification: predicate('value', 'eq', 'OK') }),
      ],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.deepEqual(report.steps.map((s) => s.capability), ['kv.set', 'kv.get', 'data.transform']);
    assert.ok(report.tasks.every((t) => t.status === 'VERIFIED'), `all tasks must be VERIFIED: ${report.tasks.map((t) => t.status)}`);
    assert.equal(report.outcome, 'COMPLETED_VERIFIED');
    assert.equal(world.get('a'), 2);
    assert.ok((await ciel.ledger.verify(mission.id)).ok, 'the ledger chain must stay intact through execution');
  });

  test('a result with no applicable verifier is COMPLETED_UNVERIFIED, never "completed"', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({ goal: 'no verifier', tasks: [task('t1', 'data.transform', { op: 'sum', value: [1, 2] })] });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.tasks[0].status, 'UNVERIFIED');
    assert.equal(report.outcome, 'COMPLETED_UNVERIFIED');
  });

  test('a task depending on an unverified result blocks the mission with an explanation', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({
      goal: 'unverified dependency',
      tasks: [
        task('t1', 'data.transform', { op: 'sum', value: [1, 2] }),
        task('t2', 'data.transform', { op: 'upper', value: 'x' }, { dependencies: ['t1'] }),
      ],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.outcome, 'BLOCKED');
    assert.ok(report.mission.status_history.some((h) => h.reason.includes('not verified')));
    assert.equal(report.tasks[1].status, 'PENDING', 'the downstream task must not run on an unverified result');
  });

  test('an execution error fails the task honestly and records a diagnostic', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({ goal: 'fail', tasks: [task('t1', 'always.fails', {})] });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.tasks[0].status, 'FAILED');
    assert.equal(report.outcome, 'FAILED');
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.diagnostic_recorded, 1);
    assert.equal(summary.by_type.mission_failed, 1);
  });

  test('a missing permission blocks the task, it does not silently skip it', async () => {
    const { ciel, world } = createRig({ permissions: [] });
    const { mission } = await ciel.compiler.compile({ goal: 'write', tasks: [task('t1', 'kv.set', { key: 'a', value: 1 })] });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(report.tasks[0].status, 'BLOCKED');
    assert.ok(report.steps[0].reason.includes('state:write'));
    assert.equal(world.has('a'), false, 'no side effect may occur when the permission is missing');
  });

  test('every observation is integrity-assessed before becoming evidence', async () => {
    const { ciel, world, store } = createRig();
    const { mission } = await ciel.compiler.compile({ goal: 'obs', tasks: [task('t1', 'kv.set', { key: 'a', value: 5 }, { verification: predicate('value', 'eq', 5) })] });
    await ciel.executor.run(mission.id, { world });
    const [observation] = await store.find('observations', {});
    assert.equal(observation.integrity.status, 'TRUSTED');
    assert.ok(observation.integrity.checks.some((c) => c.name === 'state_observed' && c.passed), 'a side-effecting capability must report observed state');
    const [evidence] = await store.find('evidence', {});
    assert.equal(evidence.kind, 'OBSERVATION');
    assert.equal(evidence.integrity, 'TRUSTED');
  });

  test('no AI call is made anywhere in a full mission', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile({
      goal: 'offline',
      tasks: [task('t1', 'data.transform', { op: 'upper', value: 'ok' }, { verification: predicate('value', 'eq', 'OK') })],
    });
    const report = await ciel.executor.run(mission.id, { world });
    assert.equal(ciel.ai_enabled, false);
    assert.equal(ciel.degradation, 'CORE_ONLY');
    assert.equal(report.budget.used.ai_calls, 0);
    assert.equal(report.budget.used.tokens, 0);
    assert.equal(report.outcome, 'COMPLETED_VERIFIED');
  });
});

suite('Phase C — Irreversible action requires authorization (persistent interruption)', (test) => {
  test('an irreversible action waits for the user, survives a restart, then runs exactly once', async () => {
    const first = createRig();
    const { mission, tasks } = await first.ciel.compiler.compile({
      goal: 'send one message',
      tasks: [task('t1', 'mail.send', { message_id: 'm-1', to: 'a@b.c', subject: 'hi' }, { verification: predicate('sent', 'eq', true) })],
    });
    const run1 = await first.ciel.executor.run(mission.id, { world: first.world });
    assert.equal(run1.outcome, 'WAITING_FOR_USER');
    assert.ok(run1.question.why_needed.includes('cannot be undone'));
    assert.equal(run1.tasks[0].status, 'WAITING_FOR_USER');
    assert.equal(first.world.operations().length, 0, 'nothing may be sent before authorization');

    // Process restart: same persisted store, same external world, fresh engines.
    first.store.restore(first.store.crash());
    const second = restart({ store: first.store, world: first.world });
    const persisted = await second.store.get('missions', mission.id);
    assert.equal(persisted.status, 'WAITING_FOR_USER', 'the interruption must be persistent, not in-memory');
    assert.ok(persisted.pending_question.text.includes('mail.send'));

    const run2 = await second.ciel.executor.run(mission.id, { world: second.world, confirmations: { [tasks[0].id]: true } });
    assert.equal(run2.outcome, 'COMPLETED_VERIFIED');
    assert.equal(second.world.operations().filter((o) => o.kind === 'mail').length, 1, 'the message must be sent exactly once');
    assert.ok((await second.ciel.ledger.verify(mission.id)).ok, 'the ledger chain must survive the restart');
  });
});