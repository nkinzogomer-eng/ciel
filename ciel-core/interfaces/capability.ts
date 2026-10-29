// Capability interface (spec §5.2, §26, §49, amendment 4.1).
//
// A capability = { manifest, execute(params, ctx), probeEffect?(params, ctx), verify?(output, ctx) }
//   execute      -> { output, observed_state? }      observed_state feeds the fingerprint
//   probeEffect  -> { occurred: boolean, evidence }  REQUIRED when idempotent === false
//   verify       -> optional independent check used by IndependentObservationVerifier
//
// ctx: { clock, policy, mission_id, task_id } — never the whole mission.
import { CielError, RuntimeRequirement, ComponentStatus, assertOneOf } from '../core/types.ts';

export const MANIFEST_REQUIRED = Object.freeze([
  'name', 'version', 'description', 'idempotent', 'reversible', 'side_effects', 'requires_runtime', 'permissions', 'status',
]);

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  for (const k of MANIFEST_REQUIRED) if (m[k] === undefined) errors.push(`manifest.${k} is required`);
  if (m.name !== undefined && !/^[a-z][a-z0-9_.]*$/.test(m.name)) errors.push('manifest.name must be lowercase dotted/underscored identifier');
  if (m.idempotent !== undefined && typeof m.idempotent !== 'boolean') errors.push('manifest.idempotent must be boolean');
  if (m.reversible !== undefined && typeof m.reversible !== 'boolean') errors.push('manifest.reversible must be boolean');
  if (m.side_effects !== undefined && !Array.isArray(m.side_effects)) errors.push('manifest.side_effects must be an array');
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) errors.push('manifest.permissions must be an array');
  if (m.requires_runtime !== undefined && !(m.requires_runtime in RuntimeRequirement)) errors.push('manifest.requires_runtime must be ANY | BASE44 | EXTERNAL');
  if (m.status !== undefined && !(m.status in ComponentStatus)) errors.push('manifest.status must be a ComponentStatus');
  if (Array.isArray(m.side_effects) && m.side_effects.length > 0 && m.permissions && m.permissions.length === 0) {
    errors.push('a side-effecting capability must declare the permissions it needs (Policy Plane)');
  }
  return { ok: errors.length === 0, errors };
}

export function createManifest(fields) {
  const m = { side_effects: [], permissions: [], requires_runtime: RuntimeRequirement.ANY, status: ComponentStatus.IMPLEMENTED, version: '0.1.0', ...fields };
  const v = validateManifest(m);
  if (!v.ok) throw new CielError('INVALID_MANIFEST', 'capability manifest is invalid', v.errors);
  assertOneOf(RuntimeRequirement, m.requires_runtime, 'requires_runtime');
  return Object.freeze({ ...m, side_effects: Object.freeze([...m.side_effects]), permissions: Object.freeze([...m.permissions]) });
}

export function assertCapability(impl) {
  if (!impl || typeof impl !== 'object') throw new CielError('INVALID_CAPABILITY', 'capability must be an object');
  const v = validateManifest(impl.manifest);
  if (!v.ok) throw new CielError('INVALID_MANIFEST', `capability manifest invalid: ${v.errors.join('; ')}`, v.errors);
  if (typeof impl.execute !== 'function') throw new CielError('INVALID_CAPABILITY', `${impl.manifest.name}: execute() is required`);
  if (impl.manifest.idempotent === false && typeof impl.probeEffect !== 'function') {
    throw new CielError('PROBE_REQUIRED', `${impl.manifest.name}: non-idempotent capabilities must implement probeEffect() so Recovery never replays blindly`);
  }
  return impl;
}