// Reference capabilities — deterministic, portable, no platform dependency (Phase C).
// They exist to exercise every branch of the engines honestly:
//   data.transform    PURE           idempotent
//   kv.get            PURE           idempotent
//   kv.set            REVERSIBLE     idempotent
//   counter.increment REVERSIBLE     NOT idempotent  -> has probeEffect()
//   mail.send         IRREVERSIBLE   NOT idempotent  -> has probeEffect(), needs confirmation
//   always.fails      PURE           always throws (failure path)
import { CielError, ComponentStatus, RuntimeRequirement } from '../core/types.ts';
import { createManifest } from '../interfaces/capability.ts';

const base = { requires_runtime: RuntimeRequirement.ANY, status: ComponentStatus.TESTED_IN_BASE44 };

export function dataTransform() {
  return {
    manifest: createManifest({ ...base, name: 'data.transform', description: 'Pure deterministic transform of a value (upper, sum, length).', idempotent: true, reversible: true, side_effects: [], permissions: [] }),
    async execute(params) {
      const { op, value } = params;
      if (op === 'upper') return { output: { value: String(value).toUpperCase() } };
      if (op === 'sum') return { output: { value: (value || []).reduce((a, b) => a + b, 0) } };
      if (op === 'length') return { output: { value: (value ?? '').length } };
      throw new CielError('UNSUPPORTED_OP', `data.transform does not support op "${op}"`);
    },
  };
}

export function kvGet(world) {
  return {
    manifest: createManifest({ ...base, name: 'kv.get', description: 'Reads a key from the world state.', idempotent: true, reversible: true, side_effects: [], permissions: [] }),
    async execute(params) {
      return { output: { key: params.key, value: world.get(params.key) ?? null, found: world.has(params.key) } };
    },
  };
}

export function kvSet(world) {
  return {
    manifest: createManifest({ ...base, name: 'kv.set', description: 'Writes a key in the world state (same key+value twice = same state).', idempotent: true, reversible: true, side_effects: ['kv'], permissions: ['state:write'] }),
    affectedState(params) { return [`kv:${params.key}`]; },
    async execute(params) {
      const previous = world.get(params.key) ?? null;
      world.set(params.key, params.value);
      return { output: { key: params.key, value: params.value, previous }, observed_state: { [`kv:${params.key}`]: params.value } };
    },
  };
}

export function counterIncrement(world) {
  return {
    manifest: createManifest({ ...base, name: 'counter.increment', description: 'Increments a counter. Running it twice is NOT the same as running it once.', idempotent: false, reversible: true, side_effects: ['counter'], permissions: ['state:write'] }),
    affectedState(params) { return [`counter:${params.key}`]; },
    async execute(params) {
      if (!params.operation_id) throw new CielError('OPERATION_ID_REQUIRED', 'counter.increment requires an operation_id so its effect can be probed after an interruption');
      const key = `counter:${params.key}`;
      const next = (world.get(key) ?? 0) + (params.by ?? 1);
      world.set(key, next);
      world.set(`op:${params.operation_id}`, { key, at: 'applied' });
      world.recordOperation({ kind: 'counter', ref: params.operation_id });
      return { output: { key: params.key, value: next }, observed_state: { [key]: next } };
    },
    async probeEffect(params) {
      const applied = world.has(`op:${params.operation_id}`);
      return { occurred: applied, evidence: { operation_id: params.operation_id, marker_found: applied, current_value: world.get(`counter:${params.key}`) ?? 0 } };
    },
  };
}

export function mailSend(world) {
  return {
    manifest: createManifest({ ...base, name: 'mail.send', description: 'Sends a message. Irreversible: it cannot be unsent.', idempotent: false, reversible: false, side_effects: ['mailbox'], permissions: ['email:send'] }),
    affectedState() { return ['mailbox']; },
    async execute(params) {
      if (!params.message_id) throw new CielError('MESSAGE_ID_REQUIRED', 'mail.send requires a message_id so a duplicate send can be detected');
      world.recordOperation({ kind: 'mail', ref: params.message_id, to: params.to });
      world.set(`mail:${params.message_id}`, { to: params.to, subject: params.subject ?? '' });
      return { output: { message_id: params.message_id, to: params.to, sent: true }, observed_state: { mailbox: world.observe('mailbox') } };
    },
    async probeEffect(params) {
      const sent = world.has(`mail:${params.message_id}`);
      return { occurred: sent, evidence: { message_id: params.message_id, found_in_mailbox: sent } };
    },
  };
}

export function alwaysFails() {
  return {
    manifest: createManifest({ ...base, name: 'always.fails', description: 'Always throws. Used to exercise the failure path.', idempotent: true, reversible: true, side_effects: [], permissions: [] }),
    async execute() { throw new CielError('CAPABILITY_FAILED', 'this capability always fails'); },
  };
}

// A non-idempotent capability with NO probeEffect cannot be registered (the interface
// refuses it), so recovery's "unknown effect" branch is exercised with an unregistered one.
export function registerReferenceCapabilities(registry, world) {
  for (const make of [dataTransform, kvGet, kvSet, counterIncrement, mailSend, alwaysFails]) registry.register(make(world));
  return registry;
}