// Arbitration (spec §15, §19, §25) — Phase D. Fully deterministic, no AI.
//
// Ranking rule, applied in this fixed order:
//   1. more independent sources supporting the option
//   2. higher epistemic level of the supporting evidence
//   3. lower declared risk
// If the top two options tie on all three, Ciel does NOT pick one: it reports a tie and
// asks the user. Arbitrary tie-breaking would be a fabricated decision.
import { CielError, DecisionType, EpistemicLevel, VerificationState } from '../core/types.ts';
import { createDecision } from '../domain/decision.ts';
import { createConfidence } from '../domain/confidence.ts';

export const ArbitrationOutcome = Object.freeze({
  DECIDED: 'DECIDED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  TIE_NEEDS_USER: 'TIE_NEEDS_USER',
});

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3, unknown: 4 };

export function scoreCandidate(c) {
  const supporting = (c.evidence || []).filter((e) => e.supports !== false);
  const sources = new Set(supporting.map((e) => e.source)).size;
  const level = supporting.reduce((m, e) => Math.max(m, e.level ?? EpistemicLevel.HYPOTHESIS), EpistemicLevel.UNKNOWN);
  return { option: c.option, sources, level, risk: RISK_ORDER[c.risk ?? 'unknown'] ?? 4, evidence_ids: supporting.map((e) => e.id).filter(Boolean) };
}

export function rank(candidates) {
  return candidates.map(scoreCandidate).sort((a, b) => b.sources - a.sources || b.level - a.level || a.risk - b.risk);
}

export function arbitrate({ id, mission_id, task_id = null, question, candidates, min_sources = 1, now }) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new CielError('NO_CANDIDATES', 'arbitration requires at least one candidate');
  const ranking = rank(candidates);
  const [top, second] = ranking;

  if (top.sources < min_sources || top.level <= EpistemicLevel.UNKNOWN) {
    return { outcome: ArbitrationOutcome.INSUFFICIENT_EVIDENCE, decision: null, ranking, reason: 'no candidate is supported by enough evidence' };
  }
  if (second && top.sources === second.sources && top.level === second.level && top.risk === second.risk) {
    return { outcome: ArbitrationOutcome.TIE_NEEDS_USER, decision: null, ranking, reason: 'candidates are indistinguishable on evidence, level and risk' };
  }

  const decision = createDecision({
    id, mission_id, task_id, type: DecisionType.CHOICE, question,
    options: candidates.map((c) => c.option), selected: top.option,
    confidence: createConfidence({
      knowledge: Math.min(1, top.level / EpistemicLevel.VERIFIED_FACT),
      evidence: Math.min(1, top.sources / 2),
      reasoning: 1, // the ranking rule is deterministic and fully specified
      execution: 0, // nothing has been executed yet
    }),
    evidence_ids: top.evidence_ids, made_by: 'ciel:arbitration',
    reason: `ranked first on independent sources (${top.sources}), epistemic level (${top.level}), risk`,
    now,
  });
  return { outcome: ArbitrationOutcome.DECIDED, decision, ranking, reason: decision.reason };
}

// Conflict resolution between claims about the same subject (spec §25).
// Rules in order: verified beats unverified, more independent sources, then freshness.
// When no rule is decisive, the answer is null — the user decides.
export function resolveConflict(claims) {
  const verified = claims.filter((c) => c.verification_state === VerificationState.VERIFIED);
  if (verified.length === 1) return { resolved: verified[0], rule: 'verification', ambiguous: false };
  const pool = verified.length > 1 ? verified : claims;
  const bySources = [...pool].sort((a, b) => (b.sources || 0) - (a.sources || 0));
  if ((bySources[0].sources || 0) > (bySources[1]?.sources || 0)) return { resolved: bySources[0], rule: 'independent_sources', ambiguous: false };
  const byFresh = [...pool].sort((a, b) => Date.parse(b.observed_at || 0) - Date.parse(a.observed_at || 0));
  if (byFresh[0].observed_at && byFresh[0].observed_at !== byFresh[1]?.observed_at) return { resolved: byFresh[0], rule: 'freshness', ambiguous: false };
  return { resolved: null, rule: null, ambiguous: true };
}