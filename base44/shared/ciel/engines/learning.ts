// Experience Learning, calibration and the Self-Model (spec §36, §37, amendment 4.5) — Phase G.
// Every experience carries the conditions under which it holds, and the self-model reports
// what Ciel knows it can do — including, explicitly, what it cannot.
import { ComponentStatus, LedgerEventType, VerificationState } from '../core/types.ts';
import { createExperience, createPrediction, resolvePrediction, calibration, MIN_CALIBRATION_SAMPLES } from '../domain/experience.ts';

export function createLearningEngine({ store, clock, newId, ledger }) {
  return {
    async recordTaskOutcome({ mission, task, observation = null, verification = null, cost = {}, context = {} }) {
      const applicability = { capability: task.action.capability, ...context };
      const experience = createExperience({
        id: newId('exp'), mission_id: mission.id, context, goal: task.goal,
        action: task.action, observation: observation?.id ?? null,
        result: { task_status: task.status, verification_state: verification?.state ?? null },
        failure: task.status === 'FAILED' ? (task.status_history[task.status_history.length - 1]?.reason ?? 'unknown') : null,
        cost, applicability,
        lesson: verification?.state === VerificationState.VERIFIED
          ? `${task.action.capability} produced a verified result under these conditions`
          : `${task.action.capability} produced a result that could not be verified (${verification?.state ?? 'no verification'})`,
        now: clock.now(),
      });
      await store.put('experiences', experience);
      await ledger.append(mission.id, LedgerEventType.experience_recorded, { experience_id: experience.id, capability: task.action.capability, result: experience.result }, { task_id: task.id });
      return experience;
    },

    async predict({ subject_id, subject_type = 'task', predictor, task_class, context = {}, prediction, confidence }) {
      const p = createPrediction({ id: newId('pred'), subject_id, subject_type, predictor, task_class, context, prediction, confidence, now: clock.now() });
      await store.put('predictions', p);
      return p;
    },

    async resolve(prediction_id, { actual_outcome, verification_state }) {
      const p = await store.get('predictions', prediction_id);
      const resolved = resolvePrediction(p, { actual_outcome, verification_state, now: clock.now() });
      await store.put('predictions', resolved);
      return resolved;
    },

    async calibrationReport(groupBy) {
      return calibration(await store.find('predictions', {}), groupBy);
    },

    // Honest self-model: capability-by-capability, measured only where there is evidence.
    async selfModel({ registry, componentStatus = [] }) {
      const experiences = await store.find('experiences', {});
      const predictions = await store.find('predictions', {});
      const calib = calibration(predictions);

      const capabilities = registry.list().map((m) => {
        const mine = experiences.filter((e) => e.applicability.capability === m.name);
        const verified = mine.filter((e) => e.result.verification_state === VerificationState.VERIFIED).length;
        return {
          capability: m.name, status: m.status,
          idempotent: m.idempotent, reversible: m.reversible,
          requires_permissions: m.permissions,
          attempts: mine.length,
          verified_results: verified,
          measured_success_rate: mine.length ? verified / mine.length : null,
          insufficient_data: mine.length < MIN_CALIBRATION_SAMPLES,
        };
      });

      return {
        can: capabilities.filter((c) => c.status === ComponentStatus.TESTED_IN_BASE44 || c.status === ComponentStatus.IMPLEMENTED).map((c) => c.capability),
        cannot: componentStatus
          .filter((c) => c.status === ComponentStatus.NOT_IMPLEMENTED || c.status === ComponentStatus.REQUIRES_EXTERNAL_RUNTIME)
          .map((c) => ({ component: c.component, status: c.status, phase: c.phase })),
        capabilities,
        calibration: calib,
        honest_note: 'Anything absent from `can` is not claimed. Rates are null until measured; a capability with fewer than '
          + `${MIN_CALIBRATION_SAMPLES} recorded outcomes is marked insufficient_data.`,
      };
    },
  };
}