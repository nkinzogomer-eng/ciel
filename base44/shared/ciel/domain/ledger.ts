// Mission Ledger events (spec §28). Append-only, hash-chained, frozen.
import { CielError, LedgerEventType, assertOneOf } from '../core/types.ts';
import { fingerprint } from '../core/fingerprint.ts';

export function createEvent({ mission_id, type, sequence, task_id = null, decision_id = null, payload = {}, prev_hash = null, now }) {
  if (!mission_id) throw new CielError('MISSING_ID', 'event mission_id is required');
  assertOneOf(LedgerEventType, type, 'event.type');
  if (!Number.isInteger(sequence) || sequence < 1) throw new CielError('INVALID_SEQUENCE', 'event sequence must be a positive integer');
  return Object.freeze({
    id: `${mission_id}:${sequence}`, mission_id, sequence, type, task_id, decision_id,
    payload: Object.freeze({ ...payload }), prev_hash, hash: null, at: now,
  });
}

export async function sealEvent(event) {
  const { hash: _ignored, ...body } = event;
  return Object.freeze({ ...body, hash: await fingerprint(body) });
}

// Verifies contiguity and chain linkage. Returns the first broken sequence, if any.
export async function verifyChain(events) {
  let prev = null;
  for (const [i, e] of events.entries()) {
    if (e.sequence !== i + 1) return { ok: false, broken_at: e.sequence, reason: 'sequence gap' };
    if (e.prev_hash !== (prev ? prev.hash : null)) return { ok: false, broken_at: e.sequence, reason: 'prev_hash mismatch' };
    const { hash, ...body } = e;
    if (hash !== await fingerprint(body)) return { ok: false, broken_at: e.sequence, reason: 'hash mismatch (event altered)' };
    prev = e;
  }
  return { ok: true, broken_at: null, reason: null };
}