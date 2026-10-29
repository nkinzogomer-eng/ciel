// MemoryStore implementation backed by Base44 entities (Phase B).
// This is the ONLY file in Ciel that knows Base44 exists. The Core speaks the
// MemoryStore contract and nothing else, so swapping this for SQLite changes no logic.
import { CielError } from '../../core/types.ts';
import { assertCollection } from '../../interfaces/memoryStore.ts';

export function createBase44EntityStore({ entity, namespace = '' }) {
  if (!entity) throw new CielError('INVALID_STORE', 'a Base44 entity accessor is required');
  const key = (collection, id) => `${namespace}${collection}:${id}`;

  async function row(collection, id) {
    const found = await entity.filter({ collection: `${namespace}${collection}`, record_id: id });
    return found[0] ?? null;
  }
  async function rows(collection, extra = {}) {
    return entity.filter({ collection: `${namespace}${collection}`, ...extra });
  }

  return {
    async put(collection, record) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'events must go through appendEvent()');
      if (!record || !record.id) throw new CielError('MISSING_ID', 'record.id is required');
      const existing = await row(collection, record.id);
      const data = {
        collection: `${namespace}${collection}`, record_id: record.id,
        mission_id: record.mission_id || record.id, payload: record,
      };
      if (existing) await entity.update(existing.id, data);
      else await entity.create(data);
      return record;
    },

    async get(collection, id) {
      assertCollection(collection);
      const found = await row(collection, id);
      return found ? found.payload : null;
    },

    async find(collection, query = {}) {
      assertCollection(collection);
      const pred = typeof query === 'function' ? query : (r) => Object.entries(query).every(([k, v]) => r[k] === v);
      const scope = typeof query === 'object' && query.mission_id ? { mission_id: query.mission_id } : {};
      return (await rows(collection, scope)).map((r) => r.payload).filter(pred);
    },

    async remove(collection, id) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'ledger events cannot be removed');
      const found = await row(collection, id);
      if (!found) return false;
      await entity.delete(found.id);
      return true;
    },

    async appendEvent(event) {
      const existing = await row('events', event.id);
      if (existing) throw new CielError('APPEND_ONLY', `event ${event.id} already exists`);
      const persisted = await this.listEvents(event.mission_id);
      const last = persisted[persisted.length - 1] ?? null;
      const expected = last ? last.sequence + 1 : 1;
      if (event.sequence !== expected) throw new CielError('SEQUENCE_GAP', `expected sequence ${expected}, got ${event.sequence}`);
      if ((last ? last.hash : null) !== event.prev_hash) throw new CielError('CHAIN_BROKEN', 'prev_hash does not match last event hash');
      await entity.create({
        collection: `${namespace}events`, record_id: event.id,
        mission_id: event.mission_id, sequence: event.sequence, payload: event,
      });
      return event;
    },

    async listEvents(missionId, fromSeq = 1) {
      const found = await rows('events', { mission_id: missionId });
      return found.map((r) => r.payload).filter((e) => e.sequence >= fromSeq).sort((a, b) => a.sequence - b.sequence);
    },

    async latestCheckpoint(missionId) {
      const found = await rows('checkpoints', { mission_id: missionId });
      const sorted = found.map((r) => r.payload).sort((a, b) => b.ledger_sequence - a.ledger_sequence);
      return sorted[0] ?? null;
    },

    async close() {},

    // Namespaced teardown, used by the persistence check so a run leaves no residue.
    async purge() {
      const all = await entity.list('-created_date', 1000);
      const mine = all.filter((r) => String(r.collection).startsWith(namespace));
      for (const r of mine) await entity.delete(r.id);
      return mine.length;
    },
    _key: key,
  };
}