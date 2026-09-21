// In-memory MemoryStore. Used by tests and as the reference implementation of the contract.
// snapshot()/restore() serialize the whole store to JSON — this is how tests simulate
// "process killed, restart from persisted state".
import { CielError } from '../../core/types.ts';
import { COLLECTIONS, assertCollection } from '../../interfaces/memoryStore.ts';

export function createInMemoryStore() {
  let data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));

  const clone = (v) => (v === undefined || v === null ? v : structuredClone(v));
  const missionEvents = (missionId) => [...data.events.values()].filter((e) => e.mission_id === missionId).sort((a, b) => a.sequence - b.sequence);

  return {
    async put(collection, record) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'events must go through appendEvent()');
      if (!record || !record.id) throw new CielError('MISSING_ID', 'record.id is required');
      data[collection].set(record.id, clone(record));
      return clone(record);
    },
    async get(collection, id) {
      assertCollection(collection);
      return clone(data[collection].get(id) ?? null);
    },
    async find(collection, query = {}) {
      assertCollection(collection);
      const pred = typeof query === 'function' ? query : (r) => Object.entries(query).every(([k, v]) => r[k] === v);
      return [...data[collection].values()].filter(pred).map(clone);
    },
    async remove(collection, id) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'ledger events cannot be removed');
      return data[collection].delete(id);
    },
    async appendEvent(event) {
      if (data.events.has(event.id)) throw new CielError('APPEND_ONLY', `event ${event.id} already exists`);
      const last = missionEvents(event.mission_id).at(-1);
      const expected = last ? last.sequence + 1 : 1;
      if (event.sequence !== expected) throw new CielError('SEQUENCE_GAP', `expected sequence ${expected}, got ${event.sequence}`);
      if ((last ? last.hash : null) !== event.prev_hash) throw new CielError('CHAIN_BROKEN', 'prev_hash does not match last event hash');
      data.events.set(event.id, Object.freeze(clone(event)));
      return event;
    },
    async listEvents(missionId, fromSeq = 1) {
      return missionEvents(missionId).filter((e) => e.sequence >= fromSeq).map(clone);
    },
    async latestCheckpoint(missionId) {
      const cps = [...data.checkpoints.values()].filter((c) => c.mission_id === missionId).sort((a, b) => b.ledger_sequence - a.ledger_sequence);
      return clone(cps[0] ?? null);
    },
    async close() {},

    // --- test-only helpers (not part of the contract) ---
    snapshot() {
      return JSON.stringify(Object.fromEntries(COLLECTIONS.map((c) => [c, [...data[c].values()]])));
    },
    restore(json) {
      const parsed = JSON.parse(json);
      data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map((parsed[c] || []).map((r) => [r.id, r]))]));
    },
    crash() {
      const snap = this.snapshot();
      data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
      return snap;
    },
    counts() {
      return Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].size]));
    },
  };
}