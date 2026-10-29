// Phase B persistence check, run against REAL persisted storage (Base44 entities).
// The Core is untouched: only the MemoryStore adapter differs from the in-memory tests.
// A second, freshly built runtime re-reads everything — that is the restart simulation.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { createBase44EntityStore } from '../../../ciel-core/adapters/base44/entityStore.ts';
import { createCiel } from '../../../ciel-core/runtime.ts';
import { createWorld } from '../../../ciel-core/capabilities/world.ts';
import { sequentialIds } from '../../../ciel-core/core/ids.ts';
import { SystemClock } from '../../../ciel-core/core/clock.ts';

const PERMISSIONS = ['state:write', 'email:send'];

export default async function (req) {
  let store = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const entity = base44.asServiceRole.entities.CielRecord;
    const namespace = `check_${Date.now()}_`;
    store = createBase44EntityStore({ entity, namespace });

    const world = createWorld({});
    const first = createCiel({
      store, clock: SystemClock, newId: sequentialIds('p1'),
      permissions: PERMISSIONS, world, withReferenceCapabilities: true,
    });

    const plan = {
      goal: 'persisted chain: write, read back, transform',
      tasks: [
        { id: 't1', goal: 'write', action: { capability: 'kv.set', params: { key: 'a', value: 2 } }, verification: { kind: 'PREDICATE', predicate: { path: 'value', op: 'eq', value: 2 } } },
        { id: 't2', goal: 'read back', action: { capability: 'kv.get', params: { key: 'a' } }, dependencies: ['t1'], verification: { kind: 'PREDICATE', predicate: { path: 'value', op: 'eq', value: 2 } } },
        { id: 't3', goal: 'transform', action: { capability: 'data.transform', params: { op: 'upper', value: 'ok' } }, dependencies: ['t2'], verification: { kind: 'PREDICATE', predicate: { path: 'value', op: 'eq', value: 'OK' } } },
      ],
    };

    const compiled = await first.compiler.compile(plan);
    const report = await first.executor.run(compiled.mission.id, { world });

    // --- restart: brand-new runtime objects, same persisted rows -----------
    const restartedStore = createBase44EntityStore({ entity, namespace });
    const second = createCiel({
      store: restartedStore, clock: SystemClock, newId: sequentialIds('p2'),
      permissions: PERMISSIONS, world, withReferenceCapabilities: true,
    });
    const persistedMission = await restartedStore.get('missions', compiled.mission.id);
    const persistedTasks = await restartedStore.find('tasks', { mission_id: compiled.mission.id });
    const chain = await second.ledger.verify(compiled.mission.id);
    const events = await second.ledger.read(compiled.mission.id);
    const checkpoint = await restartedStore.latestCheckpoint(compiled.mission.id);

    let appendOnly = 'not tested';
    try {
      await restartedStore.remove('events', events[0].id);
      appendOnly = 'FAILED: an event was removable';
    } catch (e) {
      appendOnly = e.code === 'APPEND_ONLY' ? 'refused' : `unexpected: ${e.code}`;
    }

    const checks = [
      { name: 'mission executed to a verified completion', ok: report.outcome === 'COMPLETED_VERIFIED', detail: report.outcome },
      { name: 'mission state survived the restart', ok: persistedMission?.status === 'COMPLETED_VERIFIED', detail: persistedMission?.status ?? 'missing' },
      { name: 'all tasks persisted as VERIFIED', ok: persistedTasks.length === 3 && persistedTasks.every((t) => t.status === 'VERIFIED'), detail: persistedTasks.map((t) => t.status).join(', ') },
      { name: 'ledger hash chain verifies from storage', ok: chain.ok, detail: chain.reason || `${events.length} events` },
      { name: 'ledger is append-only in storage', ok: appendOnly === 'refused', detail: appendOnly },
      { name: 'final checkpoint has no action in flight', ok: Boolean(checkpoint) && checkpoint.in_flight_actions.length === 0, detail: checkpoint ? `sequence ${checkpoint.ledger_sequence}` : 'missing' },
      { name: 'no AI call was made', ok: report.budget.used.ai_calls === 0 && second.degradation === 'CORE_ONLY', detail: second.degradation },
    ];

    const removed = await store.purge();

    return Response.json({
      adapter: 'Base44 entities (CielRecord)',
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      checks,
      rows_written_then_purged: removed,
      ledger_events: events.length,
    });
  } catch (error) {
    if (store) { try { await store.purge(); } catch (_) { /* purge is best-effort */ } }
    return Response.json({ error: error.message, code: error.code ?? null, stack: error.stack }, { status: 500 });
  }
}