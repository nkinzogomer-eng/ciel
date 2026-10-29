// Mission Ledger service (spec §28) — Phase B.
// Every append computes its own sequence and prev_hash from what is already persisted,
// then seals the event. The store refuses gaps and broken links, so a lost write is
// detectable rather than silently absorbed.
import { createEvent, sealEvent, verifyChain } from '../domain/ledger.ts';
import { assertMemoryStore } from '../interfaces/memoryStore.ts';
import { assertClock } from '../core/clock.ts';

export function createLedgerService({ store, clock }) {
  assertMemoryStore(store);
  assertClock(clock);

  async function last(mission_id) {
    const events = await store.listEvents(mission_id);
    return events.length ? events[events.length - 1] : null;
  }

  return {
    async append(mission_id, type, payload = {}, { task_id = null, decision_id = null } = {}) {
      const prev = await last(mission_id);
      const event = createEvent({
        mission_id, type, sequence: prev ? prev.sequence + 1 : 1,
        task_id, decision_id, payload, prev_hash: prev ? prev.hash : null, now: clock.now(),
      });
      const sealed = await sealEvent(event);
      await store.appendEvent(sealed);
      return sealed;
    },
    async read(mission_id, fromSeq = 1) {
      return store.listEvents(mission_id, fromSeq);
    },
    async lastSequence(mission_id) {
      const prev = await last(mission_id);
      return prev ? prev.sequence : 0;
    },
    async verify(mission_id) {
      return verifyChain(await store.listEvents(mission_id));
    },
    // Counts per event type — the cheap "what happened" view used by reports and tests.
    async summary(mission_id) {
      const events = await store.listEvents(mission_id);
      const by_type = {};
      for (const e of events) by_type[e.type] = (by_type[e.type] || 0) + 1;
      return { count: events.length, by_type, first_at: events[0]?.at ?? null, last_at: events[events.length - 1]?.at ?? null };
    },
  };
}