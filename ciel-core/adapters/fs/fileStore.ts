// Durable MemoryStore on the local filesystem — no database, no driver, no dependency.
//
// Why this exists: without it, "Ciel runs without Base44" would be true but useless — the
// in-memory store loses every mission on restart, and the whole point of the ledger and the
// checkpoints is to survive a crash. This adapter closes that gap with `node:fs` only
// (available in Node, Deno and Bun), so persistence no longer requires the platform.
//
// Layout under <dir>:
//   records/<collection>/<encoded id>.json   one file per record, written atomically
//   events/<encoded mission_id>.jsonl        append-only, one sealed event per line
//
// Guarantees
//   - a record write is atomic (tmp file + rename): a reader never sees a half-written record;
//   - the event log is append-only and validated against the persisted chain on every append
//     (duplicate id, sequence gap, broken prev_hash are refused), exactly like the in-memory store;
//   - a torn final line (process killed mid-append) is ignored, and the gap it leaves is then
//     reported by ledger.verify() rather than silently absorbed.
//
// Non-guarantees (documented on purpose)
//   - one process at a time: there is no inter-process lock;
//   - the filesystem is trusted: someone with write access can delete files, and that is a
//     tamper-EVIDENT situation (the chain check reports it), not tamper-proof.
import { CielError } from '../../core/types.ts';
import { COLLECTIONS, assertCollection } from '../../interfaces/memoryStore.ts';

const enc = (id) => encodeURIComponent(String(id)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const safeCollection = (c) => assertCollection(c);

export async function createFileStore({ dir, fs = null } = {}) {
  if (!dir) throw new CielError('INVALID_STORE', 'createFileStore requires a directory');
  const nodeFs = fs || await import('node:fs/promises');
  const path = await import('node:path');

  const root = path.resolve(dir);
  const recordsDir = (collection) => path.join(root, 'records', safeCollection(collection));
  const recordFile = (collection, id) => path.join(recordsDir(collection), `${enc(id)}.json`);
  const eventsFile = (missionId) => path.join(root, 'events', `${enc(missionId)}.jsonl`);

  async function ensure(dirPath) { await nodeFs.mkdir(dirPath, { recursive: true }); }

  async function writeAtomic(file, text) {
    await ensure(path.dirname(file));
    const tmp = `${file}.${process?.pid ?? 0}.tmp`;
    await nodeFs.writeFile(tmp, text, 'utf8');
    await nodeFs.rename(tmp, file);
  }

  async function readJson(file) {
    try {
      return JSON.parse(await nodeFs.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new CielError('STORE_CORRUPT', `cannot read ${file}: ${e.message}`);
    }
  }

  async function listDir(dirPath) {
    try { return await nodeFs.readdir(dirPath); } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async function allRecords(collection) {
    const dirPath = recordsDir(collection);
    const files = await listDir(dirPath);
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const rec = await readJson(path.join(dirPath, f));
      if (rec) out.push(rec);
    }
    return out;
  }

  // --- event log -------------------------------------------------------------
  // In-process serialization per mission: two concurrent appends cannot race on the sequence.
  const queues = new Map();
  function serialized(missionId, fn) {
    const previous = queues.get(missionId) || Promise.resolve();
    const next = previous.then(fn, fn);
    queues.set(missionId, next.catch(() => {}));
    return next;
  }

  async function readLog(missionId) {
    const file = eventsFile(missionId);
    let raw;
    try { raw = await nodeFs.readFile(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return { events: [], torn: false };
      throw e;
    }
    const lines = raw.split('\n');
    const events = [];
    let torn = false;
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch (_) {
        const isLast = lines.slice(i + 1).every((l) => !l.trim());
        // A torn final line is a crash artefact; anything else is corruption.
        if (!isLast) throw new CielError('STORE_CORRUPT', `event log for ${missionId} is corrupt at line ${i + 1}`);
        torn = true;
      }
    }
    return { events: events.sort((a, b) => a.sequence - b.sequence), torn };
  }

  async function readEvents(missionId) { return (await readLog(missionId)).events; }

  return {
    async put(collection, record) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'events must go through appendEvent()');
      if (!record || !record.id) throw new CielError('MISSING_ID', 'record.id is required');
      await writeAtomic(recordFile(collection, record.id), JSON.stringify(record));
      return record;
    },

    async get(collection, id) {
      assertCollection(collection);
      return readJson(recordFile(collection, id));
    },

    async find(collection, query = {}) {
      assertCollection(collection);
      const pred = typeof query === 'function' ? query : (r) => Object.entries(query).every(([k, v]) => r[k] === v);
      return (await allRecords(collection)).filter(pred);
    },

    async remove(collection, id) {
      assertCollection(collection);
      if (collection === 'events') throw new CielError('APPEND_ONLY', 'ledger events cannot be removed');
      try { await nodeFs.unlink(recordFile(collection, id)); return true; } catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
      }
    },

    async appendEvent(event) {
      return serialized(event.mission_id, async () => {
        const { events, torn } = await readLog(event.mission_id);
        // A crash left half a line: repair it before appending, or the next event would land
        // behind an unparsable line and the whole log would look corrupt.
        if (torn) {
          const repaired = events.map((e) => `${JSON.stringify(e)}\n`).join('');
          await writeAtomic(eventsFile(event.mission_id), repaired);
        }
        if (events.some((e) => e.id === event.id)) throw new CielError('APPEND_ONLY', `event ${event.id} already exists`);
        const last = events[events.length - 1] ?? null;
        const expected = last ? last.sequence + 1 : 1;
        if (event.sequence !== expected) throw new CielError('SEQUENCE_GAP', `expected sequence ${expected}, got ${event.sequence}`);
        if ((last ? last.hash : null) !== event.prev_hash) throw new CielError('CHAIN_BROKEN', 'prev_hash does not match last event hash');
        const file = eventsFile(event.mission_id);
        await ensure(path.dirname(file));
        await nodeFs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
        return event;
      });
    },

    async listEvents(missionId, fromSeq = 1) {
      return (await readEvents(missionId)).filter((e) => e.sequence >= fromSeq);
    },

    async latestCheckpoint(missionId) {
      const all = await allRecords('checkpoints');
      const mine = all.filter((c) => c.mission_id === missionId).sort((a, b) => b.ledger_sequence - a.ledger_sequence);
      return mine[0] ?? null;
    },

    async close() {
      await Promise.all([...queues.values()].map((p) => p.catch(() => {})));
      queues.clear();
    },

    // --- helpers (not part of the contract) ---------------------------------
    root,
    async stats() {
      const out = {};
      for (const c of COLLECTIONS) out[c] = (await listDir(recordsDir(c))).filter((f) => f.endsWith('.json')).length;
      out.event_logs = (await listDir(path.join(root, 'events'))).filter((f) => f.endsWith('.jsonl')).length;
      return out;
    },
  };
}
