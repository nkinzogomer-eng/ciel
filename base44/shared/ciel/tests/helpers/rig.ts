// Test rig: a complete Ciel runtime with a deterministic clock, sequential ids,
// an in-memory store and the reference capabilities. No AI, no platform.
import { createInMemoryStore } from '../../adapters/memory/inMemoryStore.ts';
import { fixedClock } from '../../core/clock.ts';
import { sequentialIds } from '../../core/ids.ts';
import { createWorld } from '../../capabilities/world.ts';
import { createConfig } from '../../core/config.ts';
import { createCiel } from '../../runtime.ts';

export function createRig({ limits = null, permissions = ['state:write', 'email:send'], initialWorld = {}, policy = {}, store: sharedStore = null, sharedWorld = null } = {}) {
  const store = sharedStore || createInMemoryStore();
  const clock = fixedClock();
  const newId = sequentialIds();
  const world = sharedWorld || createWorld(initialWorld);
  const config = createConfig({ ...(limits ? { budget: { default_limits: limits } } : {}), policy });
  const ciel = createCiel({ store, clock, newId, config, permissions, world, withReferenceCapabilities: true });
  return { store, clock, newId, world, config, ciel };
}

// Restarts Ciel on the SAME persisted store and the same external world — the way a
// process restart looks from the outside.
export function restart({ store, world, permissions = ['state:write', 'email:send'], policy = {}, limits = null }) {
  const clock = fixedClock('2026-01-02T00:00:00.000Z');
  const newId = sequentialIds('r');
  const config = createConfig({ ...(limits ? { budget: { default_limits: limits } } : {}), policy });
  const ciel = createCiel({ store, clock, newId, config, permissions, world, withReferenceCapabilities: true });
  return { store, clock, newId, world, config, ciel };
}

export const predicate = (path, op, value) => ({ kind: 'PREDICATE', predicate: { path, op, value } });