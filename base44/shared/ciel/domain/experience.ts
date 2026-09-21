// Experience Learning + empirical calibration (spec §36, amendment 4.5).
// Calibration is measured per (predictor, task_class[, context]) on VERIFIED outcomes only.
// There is deliberately no global "model X is N% reliable" number.
import { CielError, VerificationState, assertUnitInterval } from '../core/types.ts';
import { deepEqual } from '../core/fingerprint.ts';

export function createExperience({
  id, mission_id, context, goal, strategy_id = null, action = null, prediction = null, observation = null,
  result, failure = null, correction = null, cost = {}, lesson = '', applicability, now,
}) {
  if (!id) throw new CielError('MISSING_ID', 'experience id is required');
  if (!applicability || Object.keys(applicability).length === 0) {
    // Generalization boundary (spec §23): an experience without conditions is a "universal law" — forbidden.
    throw new CielError('APPLICABILITY_REQUIRED', 'an experience must record the conditions under which it holds');
  }
  if (!result) throw new CielError('RESULT_REQUIRED', 'an experience must record the real result');
  return { id, mission_id, context, goal, strategy_id, action, prediction, observation, result, failure, correction, cost, lesson, applicability, created_at: now };
}

export function createPrediction({ id, subject_id, subject_type, predictor, task_class, context = {}, prediction, confidence, now }) {
  if (!id || !subject_id) throw new CielError('MISSING_ID', 'prediction id and subject_id are required');
  if (!predictor || !task_class) throw new CielError('INVALID_PREDICTION', 'predictor and task_class are required');
  assertUnitInterval(confidence, 'prediction.confidence');
  return {
    id, subject_id, subject_type, predictor, task_class, context, prediction, confidence,
    actual_outcome: null, verification_state: null, hit: null, resolved_at: null, created_at: now,
  };
}

// Only VERIFIED outcomes count. An unverified outcome cannot teach Ciel whether it was right.
export function resolvePrediction(p, { actual_outcome, verification_state, now }) {
  const verified = verification_state === VerificationState.VERIFIED;
  return { ...p, actual_outcome, verification_state, hit: verified ? deepEqual(p.prediction, actual_outcome) : null, resolved_at: now };
}

export const MIN_CALIBRATION_SAMPLES = 5;

export function calibration(predictions, groupBy = (p) => `${p.predictor}|${p.task_class}`) {
  const groups = {};
  for (const p of predictions) {
    if (p.hit === null || p.hit === undefined) continue;
    const key = groupBy(p);
    const g = groups[key] || (groups[key] = { count: 0, confidence_sum: 0, hits: 0 });
    g.count += 1; g.confidence_sum += p.confidence; g.hits += p.hit ? 1 : 0;
  }
  return Object.fromEntries(Object.entries(groups).map(([k, g]) => {
    const mean_confidence = g.confidence_sum / g.count;
    const hit_rate = g.hits / g.count;
    return [k, {
      count: g.count, mean_confidence, hit_rate,
      gap: mean_confidence - hit_rate, // > 0 overconfident, < 0 underconfident
      insufficient_data: g.count < MIN_CALIBRATION_SAMPLES,
    }];
  }));
}