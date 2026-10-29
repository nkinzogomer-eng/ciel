// Phase B — persistence, ledger service, checkpoints and crash recovery.
// The critical test: a process killed mid-action must never duplicate a non-idempotent effect.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { RecoveryNext } from '../../engines/recoveryEngine.ts';

const onePlan = (capability, params, verification = null) => ({
  goal: `run ${capability}`,
  tasks: [{ id: 't1', goal: 't1', action: { capability, params }, verification }],
});

suite('Phase B — Ledger service & persistence', (test) => {
  test('sequences and chains events automatically, and verifies its own chain', async () => {
    const { ciel } = createRig();
    const { mission } = await ciel.compiler.compile(onePlan('data.transform', { op: 'upper', value: 'x' }));
    await ciel.ledger.append(mission.id, 'diagnostic_recorded', { note: 'a' });
    await ciel.ledger.append(mission.id, 'diagnostic_recorded', { note: 'b' });
    const events = await ciel.ledger.read(mission.id);
    assert.deepEqual(events.map((e) => e.sequence), events.map((_, i) => i + 1), 'sequences must be contiguous from 1');
    for (let i = 1; i < events.length; i += 1) assert.equal(events[i].prev_hash, events[i - 1].hash, 'each event links to the previous one');
    const chain = await ciel.ledger.verify(mission.id);
    assert.ok(chain.ok, `chain must verify: ${chain.reason}`);
  });

  test('the ledger survives a process crash and still verifies', async () => {
    const { ciel, store } = createRig();
    const { mission } = await ciel.compiler.compile(onePlan('data.transform', { op: 'upper', value: 'x' }));
    const before = await ciel.ledger.read(mission.id);
    store.restore(store.crash());
    const after = await ciel.ledger.read(mission.id);
    assert.deepEqual(after.map((e) => e.hash), before.map((e) => e.hash), 'events must be identical after restore');
    assert.ok((await ciel.ledger.verify(mission.id)).ok);
  });

  test('a ledger event can never be removed', async () => {
    const { ciel, store } = createRig();
    const { mission } = await ciel.compiler.compile(onePlan('data.transform', { op: 'upper', value: 'x' }));
    await assert.rejects(() => store.remove('events', `${mission.id}:1`), 'APPEND_ONLY');
  });

  test('a checkpoint is written BEFORE the action, carrying the in-flight action', async () => {
    const { ciel, world } = createRig();
    const { mission } = await ciel.compiler.compile(onePlan('kv.set', { key: 'a', value: 1 }, predicate('value', 'eq', 1)));
    await ciel.executor.run(mission.id, { world });
    const cps = await ciel.checkpoints.all(mission.id);
    const inflight = cps.filter((c) => c.in_flight_actions.length === 1);
    assert.equal(inflight.length, 1, 'exactly one checkpoint must describe the action in flight');
    assert.equal(inflight[0].in_flight_actions[0].capability, 'kv.set');
    assert.equal(inflight[0].tasks[0].status, 'RUNNING', 'the checkpointed task must be RUNNING');
    assert.equal(cps[cps.length - 1].in_flight_actions.length, 0, 'the final checkpoint must have no action in flight');
  });
});

suite('Phase B — Crash recovery (no duplicated effect)', (test) => {
  // The scenario: counter.increment applied its effect, then the process died before
  // anything was recorded. Replaying it blindly would count twice.
  test('CRITICAL: a non-idempotent action whose effect happened is NOT replayed', async () => {
    const { ciel, store, world, clock } = createRig();
    const params = { key: 'c', operation_id: 'op-1' };
    const { mission, tasks } = await ciel.compiler.compile(onePlan('counter.increment', params));
    const running = { ...tasks[0], status: 'RUNNING' };
    await ciel.checkpoints.save({
      mission, tasks: [running],
      in_flight_actions: [{ task_id: running.id, capability: 'counter.increment', params, idempotent: false, started_at: clock.now() }],
    });
    await ciel.registry.get('counter.increment').execute(params, {}); // effect applied
    store.restore(store.crash());                                    // process killed & restarted

    const rec = await ciel.recovery.recover(mission.id, { world });
    assert.ok(rec.recovered);
    assert.equal(rec.actions[0].next, RecoveryNext.MARK_SUCCEEDED);
    assert.equal(rec.actions[0].effect_occurred, true);
    assert.equal(rec.tasks[0].status, 'SUCCEEDED');
    assert.equal(world.get('counter:c'), 1, 'the counter must still be 1 — the effect must not be applied twice');
  });

  test('a non-idempotent action whose effect did NOT happen is replayed exactly once', async () => {
    const { ciel, store, world, clock } = createRig();
    const params = { key: 'c', operation_id: 'op-2' };
    const { mission, tasks } = await ciel.compiler.compile(onePlan('counter.increment', params));
    await ciel.checkpoints.save({
      mission, tasks: [{ ...tasks[0], status: 'RUNNING' }],
      in_flight_actions: [{ task_id: tasks[0].id, capability: 'counter.increment', params, idempotent: false, started_at: clock.now() }],
    });
    store.restore(store.crash());

    const rec = await ciel.recovery.recover(mission.id, { world });
    assert.equal(rec.actions[0].effect_occurred, false);
    assert.equal(rec.actions[0].next, RecoveryNext.REPLAY);
    assert.equal(rec.tasks[0].status, 'READY', 'the task goes back to READY so it can run again');
    await ciel.registry.get('counter.increment').execute(params, {});
    assert.equal(world.get('counter:c'), 1);
  });

  test('an idempotent action is replayed without probing', async () => {
    const { ciel, world, clock } = createRig();
    const params = { key: 'a', value: 7 };
    const { mission, tasks } = await ciel.compiler.compile(onePlan('kv.set', params));
    await ciel.checkpoints.save({
      mission, tasks: [{ ...tasks[0], status: 'RUNNING' }],
      in_flight_actions: [{ task_id: tasks[0].id, capability: 'kv.set', params, idempotent: true, started_at: clock.now() }],
    });
    const rec = await ciel.recovery.recover(mission.id, { world });
    assert.equal(rec.actions[0].next, RecoveryNext.REPLAY);
    assert.equal(rec.actions[0].effect_occurred, null, 'no probe is needed for an idempotent action');
  });

  test('an unknown effect is never guessed: Ciel asks the user', async () => {
    const { ciel, world, clock } = createRig();
    const { mission, tasks } = await ciel.compiler.compile(onePlan('data.transform', { op: 'upper', value: 'x' }));
    await ciel.checkpoints.save({
      mission, tasks: [{ ...tasks[0], status: 'RUNNING' }],
      in_flight_actions: [{ task_id: tasks[0].id, capability: 'ghost.capability', params: {}, idempotent: false, started_at: clock.now() }],
    });
    const rec = await ciel.recovery.recover(mission.id, { world });
    assert.equal(rec.actions[0].next, RecoveryNext.ASK_USER);
    assert.equal(rec.actions[0].effect_occurred, 'UNKNOWN');
    assert.equal(rec.tasks[0].status, 'WAITING_FOR_USER');
  });

  test('recovery without a checkpoint reports that plainly', async () => {
    const { ciel, world } = createRig();
    const rec = await ciel.recovery.recover('mission_absent', { world });
    assert.equal(rec.recovered, false);
    assert.equal(rec.reason, 'no checkpoint persisted');
  });

  test('the effect probe is recorded in the ledger', async () => {
    const { ciel, world, clock } = createRig();
    const params = { key: 'c', operation_id: 'op-3' };
    const { mission, tasks } = await ciel.compiler.compile(onePlan('counter.increment', params));
    await ciel.checkpoints.save({
      mission, tasks: [{ ...tasks[0], status: 'RUNNING' }],
      in_flight_actions: [{ task_id: tasks[0].id, capability: 'counter.increment', params, idempotent: false, started_at: clock.now() }],
    });
    await ciel.recovery.recover(mission.id, { world });
    const summary = await ciel.ledger.summary(mission.id);
    assert.equal(summary.by_type.action_effect_probed, 1);
    assert.equal(summary.by_type.checkpoint_restored, 1);
  });
});