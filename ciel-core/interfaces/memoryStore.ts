// MemoryStore interface (spec §42, §43).
// The Core only speaks this contract. Implementations: in-memory (tests), Base44 entities
// (prototype adapter, Phase B), SQLite (external runtime). None of them leak into the Core.
//
// Contract (all async):
//   put(collection, record)            upsert by record.id            -> record
//   get(collection, id)                                               -> record | null
//   find(collection, query)            query: plain-object equality or predicate fn -> record[]
//   remove(collection, id)             forbidden on 'events'          -> boolean
//   appendEvent(event)                 append-only, sequence must be last+1 for its mission -> event
//   listEvents(mission_id, fromSeq=1)  ordered by sequence            -> event[]
//   latestCheckpoint(mission_id)                                      -> checkpoint | null
//   close()
import { CielError } from '../core/types.ts';

export const COLLECTIONS = Object.freeze([
  'missions', 'tasks', 'events', 'checkpoints', 'knowledge', 'hypotheses', 'evidence', 'observations',
  'decisions', 'strategies', 'action_plans', 'experiences', 'predictions', 'verifications', 'budgets',
  'capabilities', 'providers', 'diagnostics', 'proposals',
]);

export const MEMORY_STORE_METHODS = Object.freeze([
  'put', 'get', 'find', 'remove', 'appendEvent', 'listEvents', 'latestCheckpoint', 'close',
]);

export function assertMemoryStore(store) {
  if (!store) throw new CielError('INVALID_STORE', 'store is required');
  const missing = MEMORY_STORE_METHODS.filter((m) => typeof store[m] !== 'function');
  if (missing.length) throw new CielError('INVALID_STORE', `store is missing methods: ${missing.join(', ')}`);
  return store;
}

export function assertCollection(name) {
  if (!COLLECTIONS.includes(name)) throw new CielError('UNKNOWN_COLLECTION', `unknown collection "${name}"`);
  return name;
}