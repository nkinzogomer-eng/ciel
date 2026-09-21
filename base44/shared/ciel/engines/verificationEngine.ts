// Verification Engine — the 4-verifier catalog (spec §18, §40, amendment 4.4) — Phase D.
//
// Absolute rules enforced here:
//   - No applicable verifier  -> UNVERIFIED. A result is never "probably fine".
//   - A model never verifies  -> performed_by is a Ciel mechanism or a human, never "ai:*".
//   - INDEPENDENT_OBSERVATION must use a DIFFERENT capability than the one being checked,
//     otherwise it is not independent and is refused.
import { VerifierKind, VerificationState, IntegrityStatus, ConflictState } from '../core/types.ts';
import { applicableVerifier, createVerificationRecord } from '../domain/verification.ts';
import { evaluatePredicate, describePredicate, getPath } from '../core/predicate.ts';
import { assessConflict } from '../domain/knowledge.ts';

export function createVerificationEngine({ clock, newId, registry }) {
  async function predicateVerifier(spec, output) {
    const req = `predicate:${describePredicate(spec.predicate)}`;
    const { passed, actual } = evaluatePredicate(output, spec.predicate);
    return passed
      ? { required: [req], satisfied: [req], contradictions: [], notes: 'predicate satisfied' }
      : { required: [req], satisfied: [], contradictions: [`${req} is false (actual: ${JSON.stringify(actual)})`], notes: 'predicate contradicted the claimed result' };
  }

  async function independentVerifier(spec, output, ctx) {
    const req = `independent_observation:${spec.capability}`;
    if (spec.capability === ctx.produced_by) {
      return { required: [req], satisfied: [], contradictions: [], notes: 'refused: the verifying capability is the one under verification (not independent)' };
    }
    const cap = registry.get(spec.capability);
    if (!cap) return { required: [req], satisfied: [], contradictions: [], notes: `no independent observer available ("${spec.capability}" is not registered)` };
    const observed = await cap.execute(spec.params || {}, { clock, mission_id: ctx.mission_id, task_id: ctx.subject_id, world: ctx.world });
    const path = spec.compare?.path;
    const expected = spec.compare?.value !== undefined ? spec.compare.value : getPath(output, path);
    const { passed, actual } = evaluatePredicate(observed.output, { path, op: spec.compare?.op || 'eq', value: expected });
    return passed
      ? { required: [req], satisfied: [req], contradictions: [], notes: `independent observation via ${spec.capability} agrees`, observation: observed.output }
      : { required: [req], satisfied: [], contradictions: [`${spec.capability} observed ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`], notes: 'independent observation disagrees', observation: observed.output };
  }

  // Agreement between the result and other independent sources holding a value for the same subject.
  async function consistencyVerifier(spec, output) {
    const req = 'consistency:independent_sources';
    const claims = [
      { value: getPath(output, spec.path), source: 'result', evidence_ids: ['result'] },
      ...(spec.against || []).map((a) => ({ value: a.value, source: a.source, evidence_ids: a.evidence_ids || [a.source] })),
    ];
    const distinctSources = new Set(claims.map((c) => c.source)).size;
    if (distinctSources < 2) {
      return { required: [req], satisfied: [], contradictions: [], notes: 'a single source cannot establish consistency' };
    }
    const state = assessConflict(claims);
    if (state === ConflictState.CONSISTENT) return { required: [req], satisfied: [req], contradictions: [], notes: `${distinctSources} independent sources agree` };
    if (state === ConflictState.CONFLICTED) return { required: [req], satisfied: [], contradictions: ['sources disagree about the same subject'], notes: 'conflict between independent sources' };
    return { required: [req], satisfied: [], contradictions: [], notes: 'insufficient evidence to assess consistency' };
  }

  function humanVerifier(spec, answer) {
    const req = `human_attestation:${spec.question}`;
    if (!answer) return { required: [req], satisfied: [], contradictions: [], notes: 'awaiting human attestation', needs_human: true, question: spec.question };
    if (answer.confirmed === true) return { required: [req], satisfied: [req], contradictions: [], notes: `attested by ${answer.by || 'user'}`, performed_by: `human:${answer.by || 'user'}` };
    return { required: [req], satisfied: [], contradictions: [`human attestation denied: ${answer.note || 'no reason given'}`], notes: 'human says the result is wrong', performed_by: `human:${answer.by || 'user'}` };
  }

  return {
    async verify({ subject_id, subject_type = 'task', spec, output, evidence_ids = [], produced_by = null, mission_id = null, humanAnswer = null, world = null }) {
      const kind = applicableVerifier(spec);
      let r = { required: [], satisfied: [], contradictions: [], notes: 'no applicable verifier was declared for this result' };
      let needs_human = false;
      let question = null;
      let performed_by = 'ciel:verification_engine';

      if (kind === VerifierKind.PREDICATE) r = await predicateVerifier(spec, output);
      else if (kind === VerifierKind.INDEPENDENT_OBSERVATION) r = await independentVerifier(spec, output, { subject_id, mission_id, produced_by, world });
      else if (kind === VerifierKind.CONSISTENCY) r = await consistencyVerifier(spec, output);
      else if (kind === VerifierKind.HUMAN_ATTESTATION) {
        r = humanVerifier(spec, humanAnswer);
        needs_human = Boolean(r.needs_human);
        question = r.question || null;
        if (r.performed_by) performed_by = r.performed_by;
      }

      const record = createVerificationRecord({
        id: newId('ver'), subject_id, subject_type, verifier_kind: kind,
        required_evidence: r.required, satisfied_evidence: r.satisfied, contradictions: r.contradictions,
        available_evidence_ids: evidence_ids, notes: r.notes, performed_by, now: clock.now(),
      });

      return { record, state: record.state, needs_human, question, observation: r.observation ?? null };
    },

    // Integrity checks applied to every observation before it may become evidence (§17).
    integrityChecks(observation, { manifest, expected_output = null }) {
      const checks = [
        { name: 'output_present', passed: observation.output !== undefined, note: 'the capability returned something' },
      ];
      if (manifest.side_effects.length > 0) {
        checks.push({
          name: 'state_observed',
          passed: observation.state_fingerprint !== null && observation.state_fingerprint !== undefined,
          note: 'a side-effecting capability must report the state it observed',
        });
      }
      if (expected_output && typeof expected_output === 'object' && Array.isArray(expected_output.fields)) {
        for (const f of expected_output.fields) {
          checks.push({ name: `field:${f}`, passed: getPath(observation.output, f) !== undefined, note: 'declared output field present' });
        }
      }
      return checks;
    },

    // Convenience: does this state let a task be called VERIFIED?
    isVerified(state) { return state === VerificationState.VERIFIED; },
    isContradicted(state) { return state === VerificationState.CONTRADICTED; },
    TRUSTED: IntegrityStatus.TRUSTED,
  };
}