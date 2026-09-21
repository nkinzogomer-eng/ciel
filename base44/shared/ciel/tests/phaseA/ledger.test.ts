import { suite, assert } from '../runner.ts';
import { createEvent, sealEvent, verifyChain } from '../../domain/ledger.ts';
import { createCheckpoint, recoveryPlan, RecoveryAction } from '../../domain/checkpoint.ts';
import { createActionPlan, riskClass, replayPolicy, invalidatedBy, RiskClass, ReplayPolicy } from '../../domain/actionGraph.ts';
import { createMission } from '../../domain/mission.ts';
import { createManifest } from '../../interfaces/capability.ts';
import { createInMemoryStore } from '../../adapters/memory/inMemoryStore.ts';
import { fixedClock } from '../../core/clock.ts';

const now = fixedClock().now();

async function chain(mission_id, types) {
  const events = [];
  let prev = null;
  for (const [i, type] of types.entries()) {
    const sealed = await sealEvent(createEvent({ mission_id, type, sequence: i + 1, prev_hash: prev, now }));
    events.push(sealed);
    prev = sealed.hash;
  }
  return events;
}

suite('Phase A · Ledger, checkpoints, recovery, action graph', (test) => {
  test('a sealed chain verifies; altering any event breaks it', async () => {
    const events = await chain('m1', ['mission_created', 'mission_compiled', 'task_started']);
    assert.deepEqual(await verifyChain(events), { ok: true, broken_at: null, reason: null });
    const tampered = [...events];
    tampered[1] = { ...events[1], payload: { injected: true } };
    const bad = await verifyChain(tampered);
    assert.equal(bad.ok, false);
    assert.equal(bad.broken_at, 2);
  });

  test('a missing event is detected as a sequence gap', async () => {
    const events = await chain('m1', ['mission_created', 'mission_compiled', 'task_started']);
    const res = await verifyChain([events[0], events[2]]);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'sequence gap');
  });

  test('unknown event types are refused', () => {
    assert.throws(() => createEvent({ mission_id: 'm', type: 'whatever', sequence: 1, now }), 'INVALID_ENUM');
    assert.throws(() => createEvent({ mission_id: 'm', type: 'task_started', sequence: 0, now }), 'INVALID_SEQUENCE');
  });

  test('the store enforces append-only, contiguous, correctly linked events', async () => {
    const store = createInMemoryStore();
    const events = await chain('m1', ['mission_created', 'mission_compiled']);
    await store.appendEvent(events[0]);
    await store.appendEvent(events[1]);
    await assert.rejects(() => store.appendEvent(events[1]), 'APPEND_ONLY');
    await assert.rejects(() => store.remove('events', events[0].id), 'APPEND_ONLY');
    await assert.rejects(() => store.put('events', events[0]), 'APPEND_ONLY');
    const gap = await sealEvent(createEvent({ mission_id: 'm1', type: 'task_started', sequence: 5, prev_hash: events[1].hash, now }));
    await assert.rejects(() => store.appendEvent(gap), 'SEQUENCE_GAP');
    const unlinked = await sealEvent(createEvent({ mission_id: 'm1', type: 'task_started', sequence: 3, prev_hash: 'sha256:nope', now }));
    await assert.rejects(() => store.appendEvent(unlinked), 'CHAIN_BROKEN');
    assert.equal((await store.listEvents('m1')).length, 2);
  });

  test('a non-idempotent interrupted action is probed, never blindly replayed', () => {
    const mission = createMission({ id: 'm1', goal: 'g', now });
    const cp = createCheckpoint({
      id: 'cp1', mission_id: 'm1', ledger_sequence: 7, mission, tasks: [],
      in_flight_actions: [
        { task_id: 't1', capability: 'http.get', params: {}, idempotent: true, started_at: now },
        { task_id: 't2', capability: 'payment.charge', params: {}, idempotent: false, started_at: now, effect_probe: { capability: 'payment.lookup' } },
      ],
      now,
    });
    const plan = recoveryPlan(cp);
    assert.equal(plan[0].action, RecoveryAction.REPLAY);
    assert.equal(plan[1].action, RecoveryAction.PROBE_EFFECT_FIRST);
    assert.equal(plan[1].replay_policy, ReplayPolicy.PROBE_BEFORE_REPLAY);
    assert.equal(plan[1].effect_probe.capability, 'payment.lookup');
  });

  test('a checkpoint refuses malformed in-flight actions and is an isolated snapshot', () => {
    const mission = createMission({ id: 'm1', goal: 'g', now });
    assert.throws(() => createCheckpoint({ id: 'c', mission_id: 'm1', ledger_sequence: 1, mission, tasks: [], in_flight_actions: [{ task_id: 't' }], now }), 'INVALID_IN_FLIGHT');
    assert.throws(() => createCheckpoint({ id: 'c', mission_id: 'm1', ledger_sequence: 1, tasks: [], now }), 'INVALID_SNAPSHOT');
    const cp = createCheckpoint({ id: 'c', mission_id: 'm1', ledger_sequence: 1, mission, tasks: [], now });
    mission.goal = 'mutated after the fact';
    assert.equal(cp.mission.goal, 'g');
  });

  test('risk class and replay policy come from the manifest, not from intent', () => {
    const pure = createManifest({ name: 'compute', description: 'pure computation', idempotent: true, reversible: true, side_effects: [] });
    const irreversible = createManifest({ name: 'email.send', description: 'send an email', idempotent: false, reversible: false, side_effects: ['mailbox'], permissions: ['email:send'] });
    assert.equal(riskClass(pure), RiskClass.PURE);
    assert.equal(riskClass(irreversible), RiskClass.IRREVERSIBLE);
    assert.equal(replayPolicy(irreversible), ReplayPolicy.PROBE_BEFORE_REPLAY);
    assert.throws(() => createActionPlan({ id: 'a1', task_id: 't1', action: { capability: 'email.send' }, manifest: irreversible, now }), 'AFFECTED_STATE_REQUIRED');
    const ap = createActionPlan({ id: 'a1', task_id: 't1', action: { capability: 'email.send' }, manifest: irreversible, affected_state: ['mailbox:alice'], now });
    assert.equal(ap.irreversible_without_rollback, true);
  });

  test('an action invalidates exactly the items depending on the state it affects', () => {
    const manifest = createManifest({ name: 'fs.write', description: 'write a file', idempotent: true, reversible: true, side_effects: ['file'], permissions: ['fs:write'] });
    const ap = createActionPlan({ id: 'a1', task_id: 't1', action: { capability: 'fs.write' }, manifest, affected_state: ['file:/etc/app.conf'], now });
    const items = [
      { id: 'k1', dependencies: ['file:/etc/app.conf'] },
      { id: 'k2', dependencies: ['file:/other'] },
      { id: 'd1', dependencies: ['file:/etc/app.conf', 'repo:head'] },
      { id: 'k3' },
    ];
    assert.deepEqual(invalidatedBy(ap, items), ['k1', 'd1']);
  });
});