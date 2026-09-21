// Cognitive Sufficiency (spec §41) — fully deterministic, no AI.
//
// Before acting, Ciel asks: do I know enough, and can I check the result?
// The answer is a recommendation, and it is conservative by construction:
//   - a blocking unknown  -> GATHER_EVIDENCE
//   - contradicting claims -> ASK_USER
//   - an irreversible action with no way to verify it -> REFUSE
//   - critical claims that are only hypotheses -> GATHER_EVIDENCE
import { CielError, EpistemicLevel } from '../core/types.ts';
import { RiskClass } from '../domain/actionGraph.ts';

export const Sufficiency = Object.freeze({
  ACT: 'ACT',
  GATHER_EVIDENCE: 'GATHER_EVIDENCE',
  ASK_USER: 'ASK_USER',
  REFUSE: 'REFUSE',
});

export function assessSufficiency({
  goal, claims = [], unknowns = [], risk_class = RiskClass.PURE,
  verification_available = true, min_level = EpistemicLevel.CORROBORATED_INFERENCE,
}) {
  if (!goal) throw new CielError('MISSING_GOAL', 'sufficiency is always assessed against a goal');

  const gaps = [];
  const blocking_unknowns = unknowns.filter((u) => u.blocking !== false).map((u) => u.question ?? String(u));
  const contradictions = claims.filter((c) => c.contradicted === true).map((c) => c.id ?? c.claim);
  const weak = claims
    .filter((c) => c.critical === true && (c.level ?? EpistemicLevel.UNKNOWN) < min_level)
    .map((c) => c.id ?? c.claim);

  if (blocking_unknowns.length) gaps.push(`unresolved unknowns: ${blocking_unknowns.join('; ')}`);
  if (contradictions.length) gaps.push(`contradicted claims: ${contradictions.join('; ')}`);
  if (weak.length) gaps.push(`critical claims below ${min_level}: ${weak.join('; ')}`);
  if (!verification_available) gaps.push('no verifier is available for the expected result');

  let recommendation = Sufficiency.ACT;
  if (risk_class === RiskClass.IRREVERSIBLE && !verification_available) recommendation = Sufficiency.REFUSE;
  else if (contradictions.length) recommendation = Sufficiency.ASK_USER;
  else if (blocking_unknowns.length || weak.length) recommendation = Sufficiency.GATHER_EVIDENCE;
  else if (!verification_available && risk_class !== RiskClass.PURE) recommendation = Sufficiency.ASK_USER;

  return {
    sufficient: recommendation === Sufficiency.ACT,
    recommendation,
    gaps,
    missing_evidence: [...blocking_unknowns, ...weak],
    reason: gaps.length ? gaps.join(' | ') : 'knowledge and verification are sufficient for this risk class',
  };
}