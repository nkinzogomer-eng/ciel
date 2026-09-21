// Capability Registry + Policy Plane check (spec §5.2, §26, §33) — Phase C.
// A capability that is not registered does not exist: the compiler refuses such a plan
// instead of discovering the gap mid-mission.
import { CielError, RuntimeRequirement } from '../core/types.ts';
import { assertCapability } from '../interfaces/capability.ts';

export function createCapabilityRegistry({ permissions = [], runtime = RuntimeRequirement.ANY } = {}) {
  const caps = new Map();
  const granted = new Set(permissions);

  return {
    register(impl) {
      assertCapability(impl);
      const { name } = impl.manifest;
      if (caps.has(name)) throw new CielError('DUPLICATE_CAPABILITY', `capability "${name}" is already registered`);
      caps.set(name, impl);
      return impl;
    },
    has(name) { return caps.has(name); },
    get(name) { return caps.get(name) ?? null; },
    manifest(name) { return caps.get(name)?.manifest ?? null; },
    list() { return [...caps.values()].map((c) => c.manifest); },
    missing(names) { return [...new Set(names)].filter((n) => !caps.has(n)); },
    grant(permission) { granted.add(permission); },
    permissions() { return [...granted]; },

    // Why an action may not run: unknown capability, missing permission, or wrong runtime.
    check(name) {
      const cap = caps.get(name);
      if (!cap) return { allowed: false, code: 'UNKNOWN_CAPABILITY', missing_permissions: [], reason: `capability "${name}" is not registered` };
      const missing_permissions = cap.manifest.permissions.filter((p) => !granted.has(p));
      if (missing_permissions.length) {
        return { allowed: false, code: 'PERMISSION_DENIED', missing_permissions, reason: `missing permission(s): ${missing_permissions.join(', ')}` };
      }
      const req = cap.manifest.requires_runtime;
      if (req !== RuntimeRequirement.ANY && req !== runtime) {
        return { allowed: false, code: 'RUNTIME_UNAVAILABLE', missing_permissions: [], reason: `requires runtime ${req}, current runtime is ${runtime}` };
      }
      return { allowed: true, code: null, missing_permissions: [], reason: null };
    },

    // What the action will touch. A capability may refine it per params; otherwise the
    // manifest's declared side effects are the state keys.
    affectedState(name, params = {}) {
      const cap = caps.get(name);
      if (!cap) return [];
      if (typeof cap.affectedState === 'function') return cap.affectedState(params);
      return [...cap.manifest.side_effects];
    },
  };
}