// Phase B (runtime) — durable persistence on the local filesystem, with no Base44 and no database.
//
// These tests are the ones that make "Ciel runs without the platform" true rather than nominal:
// a mission is executed, the process is simulated dead (stores closed, reopened), and everything
// is read back from disk — including the hash chain and the append-only refusal.
//
// The suite skips itself (passes trivially) on a runtime without node:fs, so the core suites stay
// runnable in a browser-like environment.
import { suite, assert } from '../runner.ts';
import { createFileStore } from '../../adapters/fs/fileStore.ts';
import { createCiel } from '../../runtime.ts';
import { createWorld } from '../../capabilities/world.ts';
import { fixedClock } from '../../core/clock.ts';
import { sequentialIds } from '../../core/ids.ts';
import { predicate } from '../helpers/rig.ts';

const PLAN = {
  goal: 'persisted chain: write, read back, transform',
  tasks: [
    { id: 't1', action: { capability: 'kv.set', params: { key: 'a', value: 2 } }, verification: predicate('value', 'eq', 2) },
    { id: 't2', action: { capability: 'kv.get', params: { key: 'a' } }, dependencies: ['t1'], verification: predicate('value', 'eq', 2) },
    { id: 't3', action: { capability: 'data.transform', params: { op: 'upper', value: 'ok' } }, dependencies: ['t2'], verification: predicate('value', 'eq', 'OK') },
  ],
};

async function platformFs() {
  try {
    const [fs, os, path] = await Promise.all([
      import('node:fs/promises'), import('node:os'), import('node:path'),
    ]);
    return { fs, os, path };
  } catch (_) {
    return null;
  }
}

async function withTempDir(fn) {
  const p = await platformFs();
  if (!p) return null;                     // no filesystem: the test is not applicable
  const dir = await p.fs.mkdtemp(p.path.join(p.os.tmpdir(), 'ciel-store-'));
  try {
    return await fn(dir, p);
  } finally {
    await p.fs.rm(dir, { recursive: true, force: true });
  }
}

const buildRuntime = (store, world) => createCiel({
  store, clock: fixedClock(), newId: sequentialIds('p'), permissions: ['state:write'],
  world, withReferenceCapabilities: true,
});

suite('Phase B (runtime) — Durable file store', (test) => {
  test('a mission written to disk is read back by a brand-new runtime', async () => {
    await withTempDir(async (dir) => {
      const world = createWorld({});
      const store = await createFileStore({ dir });
      const first = buildRuntime(store, world);
      const r = await first.run(PLAN);
      assert.equal(r.outcome, 'COMPLETED_VERIFIED');
      await store.close();

      // --- restart: new store object, new runtime, same directory -----------
      const reopened = await createFileStore({ dir });
      const second = buildRuntime(reopened, world);
      const mission = await reopened.get('missions', r.mission.id);
      assert.ok(mission, 'the mission must be on disk');
      assert.equal(mission.status, 'COMPLETED_VERIFIED');
      const tasks = await reopened.find('tasks', { mission_id: r.mission.id });
      assert.equal(tasks.length, 3);
      assert.equal(tasks.every((t) => t.status === 'VERIFIED'), true);
      const chain = await second.ledger.verify(r.mission.id);
      assert.equal(chain.ok, true, `chain broken: ${chain.reason}`);
      const checkpoint = await reopened.latestCheckpoint(r.mission.id);
      assert.ok(checkpoint);
      assert.equal(checkpoint.in_flight_actions.length, 0);
      await reopened.close();
    });
  });

  test('the ledger is append-only on disk, with the same refusals as memory', async () => {
    await withTempDir(async (dir) => {
      const store = await createFileStore({ dir });
      const ciel = buildRuntime(store, createWorld({}));
      const r = await ciel.run(PLAN);
      await assert.rejects(() => store.remove('events', 'anything'), 'APPEND_ONLY');
      await assert.rejects(() => store.put('events', { id: 'x' }), 'APPEND_ONLY');

      const events = await store.listEvents(r.mission.id);
      await assert.rejects(() => store.appendEvent({ ...events[1], sequence: 99, prev_hash: 'nope' }), 'APPEND_ONLY');

      const last = events[events.length - 1];
      await assert.rejects(
        () => store.appendEvent({ ...last, id: `${r.mission.id}:999`, sequence: last.sequence + 2, prev_hash: last.hash }),
        'SEQUENCE_GAP',
        'a sequence gap must be refused',
      );
      await assert.rejects(
        () => store.appendEvent({ ...last, id: `${r.mission.id}:998`, sequence: last.sequence + 1, prev_hash: 'sha256:wrong' }),
        'CHAIN_BROKEN',
        'a wrong prev_hash must be refused',
      );
      await store.close();
    });
  });

  test('a tampered event on disk is detected by the chain check', async () => {
    await withTempDir(async (dir, p) => {
      const store = await createFileStore({ dir });
      const ciel = buildRuntime(store, createWorld({}));
      const r = await ciel.run(PLAN);
      await store.close();

      const file = p.path.join(dir, 'events', `${encodeURIComponent(r.mission.id)}.jsonl`);
      const lines = (await p.fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
      const victim = JSON.parse(lines[4]);
      victim.payload = { ...victim.payload, tampered: true };
      lines[4] = JSON.stringify(victim);
      await p.fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');

      const reopened = await createFileStore({ dir });
      const second = buildRuntime(reopened, createWorld({}));
      const chain = await second.ledger.verify(r.mission.id);
      assert.equal(chain.ok, false, 'an altered event must break the chain');
      assert.ok(/hash mismatch|altered/.test(chain.reason), chain.reason);
      await reopened.close();
    });
  });

  test('a torn last line from a crash is repaired, and later appends still work', async () => {
    await withTempDir(async (dir, p) => {
      const store = await createFileStore({ dir });
      const ciel = buildRuntime(store, createWorld({}));
      const r = await ciel.run(PLAN);
      await store.close();

      const file = p.path.join(dir, 'events', `${encodeURIComponent(r.mission.id)}.jsonl`);
      await p.fs.appendFile(file, '{"id":"half-writ', 'utf8');

      const reopened = await createFileStore({ dir });
      const events = await reopened.listEvents(r.mission.id);
      assert.ok(events.length >= 20, 'the valid events are still readable');

      // Appending repairs the torn tail instead of failing forever.
      const last = events[events.length - 1];
      const next = { ...last, id: `${r.mission.id}:${last.sequence + 1}`, sequence: last.sequence + 1, prev_hash: last.hash, payload: {} };
      await reopened.appendEvent(next);
      const after = await reopened.listEvents(r.mission.id);
      assert.equal(after.length, events.length + 1);
      const raw = await p.fs.readFile(file, 'utf8');
      assert.equal(raw.includes('half-writ'), false, 'the torn line must be gone after the repair');
      await reopened.close();
    });
  });

  test('records are written atomically and read back unchanged', async () => {
    await withTempDir(async (dir) => {
      const store = await createFileStore({ dir });
      const record = { id: 'misc:1', nested: { list: [1, 2, 3] }, when: '2026-01-01T00:00:00.000Z' };
      await store.put('diagnostics', record);
      assert.deepEqual(await store.get('diagnostics', 'misc:1'), record);
      await store.put('diagnostics', { ...record, nested: { list: [4] } });
      assert.deepEqual((await store.get('diagnostics', 'misc:1')).nested.list, [4], 'put is an upsert');
      assert.equal(await store.get('diagnostics', 'missing'), null);
      const stats = await store.stats();
      assert.equal(stats.diagnostics, 1);
      await store.close();
    });
  });

  test('the store contract refuses unknown collections and ids', async () => {
    await withTempDir(async (dir) => {
      const store = await createFileStore({ dir });
      await assert.rejects(() => store.put('nope', { id: 'x' }), 'UNKNOWN_COLLECTION');
      await assert.rejects(() => store.put('missions', { goal: 'no id' }), 'MISSING_ID');
      await store.close();
    });
  });
});
