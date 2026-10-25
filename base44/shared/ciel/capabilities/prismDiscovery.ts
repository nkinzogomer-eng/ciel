// Ciel ↔ PRISM read-only discovery boundary.
// This is a real Ciel capability with an INJECTED external runtime runner;
// neither Ciel's portable core nor this adapter executes shell commands.
// Evidence produced by PRISM is UNVERIFIED until an independent Ciel verifier
// checks source hashes and safely replays the behavioral witness.
import { CielError, ComponentStatus, RuntimeRequirement } from '../core/types.ts';
import { createManifest } from '../interfaces/capability.ts';

const ADAPTERS = Object.freeze(['starlette_static', 'werkzeug_windows_path']);

export function validatePrismEnvelope(data, { mission_id, task_id, source_sha256 }) {
  if (!data || data.schema !== 'scm.prism.ciel-capability.v1' ||
      data.capability !== 'prism.cyber.discovery') {
    throw new CielError('PRISM_SCHEMA', 'unknown or untrusted PRISM capability output');
  }
  if (data.mission_id !== mission_id || data.task_id !== task_id) {
    throw new CielError('PRISM_CORRELATION', 'PRISM mission/task correlation mismatch');
  }
  if (data.execution_policy !== 'LOCAL_READ_ONLY' ||
      data.ciel_verification_state !== 'UNVERIFIED' ||
      data.needs_independent_attestation !== true ||
      data.claim_of_new_vulnerability !== false) {
    throw new CielError('PRISM_TRUST', 'PRISM cannot claim self-verification or novelty');
  }
  const r = data.observation;
  if (!r || r.schema !== 'scm.prism.discovery.v1' ||
      !['LOCAL_PROPERTY_WITNESS', 'NO_WITNESS_NOT_SAFE'].includes(r.status) ||
      r.target?.source_sha256 !== source_sha256 ||
      !Array.isArray(r.observations) ||
      !Number.isInteger(r.budget?.used_probes) ||
      !Number.isInteger(r.budget?.max_probes) ||
      r.budget.used_probes !== r.observations.length ||
      r.budget.used_probes > r.budget.max_probes ||
      !/^[a-f0-9]{64}$/.test(r.replay_sha256 ?? '') ||
      r.verification?.previously_unknown_vulnerability_confirmed !== false ||
      r.verification?.overall_program_safety_proved !== false) {
    throw new CielError('PRISM_EVIDENCE', 'malformed or overclaimed PRISM observation');
  }
  if (r.status === 'NO_WITNESS_NOT_SAFE' && r.minimal_observed_witness !== null) {
    throw new CielError('PRISM_EVIDENCE', 'no witness status contradicts witness payload');
  }
  if (r.status === 'LOCAL_PROPERTY_WITNESS' &&
      (!r.minimal_observed_witness || r.observed_property_violations < 1)) {
    throw new CielError('PRISM_EVIDENCE', 'local witness status has no evidence');
  }
  return r;
}

export function createPrismDiscoveryCapability({ runPrism, authorizeSource }) {
  if (typeof runPrism !== 'function' || typeof authorizeSource !== 'function') {
    throw new CielError('PRISM_RUNNER', 'injected runner and external source authorization required');
  }
  return {
    manifest: createManifest({
      name: 'prism.cyber.discovery',
      version: '0.1.0',
      description: 'Run an authorized PRISM source-only local test in an externally isolated process; output observations, not verified security claims.',
      idempotent: true,
      reversible: true,
      side_effects: [],
      requires_runtime: RuntimeRequirement.EXTERNAL,
      permissions: ['cyber:local-audit'],
      status: ComponentStatus.REQUIRES_EXTERNAL_RUNTIME,
    }),
    async execute(params, ctx = {}) {
      const source_sha256 = params?.source_sha256;
      if (!ADAPTERS.includes(params?.adapter) ||
          typeof params?.source_path !== 'string' || !params.source_path ||
          !/^[a-f0-9]{64}$/.test(source_sha256 ?? '') ||
          !Number.isInteger(params?.max_probes) ||
          params.max_probes < 1 || params.max_probes > 1000 ||
          !ctx.mission_id || !ctx.task_id) {
        throw new CielError('PRISM_PARAMS', 'missing source hash, bounded adapter, or mission/task id');
      }
      // The Policy Plane permission must ALSO be granted to the registry.
      // Merely setting params.authorized is never sufficient.
      const scopeAllowed = await authorizeSource({
        source_path: params.source_path,
        source_sha256, adapter: params.adapter,
        mission_id: ctx.mission_id,
        task_id: ctx.task_id,
      });
      if (scopeAllowed !== true) throw new CielError('PRISM_SCOPE', 'scope not independently authorized');
      const reply = await runPrism({
        ...params, mission_id: ctx.mission_id, task_id: ctx.task_id,
        authorization: 'POLICY_APPROVED_READ_ONLY',
      });
      const observation = validatePrismEnvelope(reply, {
        mission_id: ctx.mission_id, task_id: ctx.task_id, source_sha256,
      });
      return {
        output: {
          capability: 'prism.cyber.discovery',
          prism_verdict: observation.status,
          observation,
          verification_state: 'UNVERIFIED',
          independent_replay_required: true,
          claimed_novel_vulnerability: false,
        },
      };
    },
  };
}
