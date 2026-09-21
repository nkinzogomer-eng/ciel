// Meta-reasoning (spec §22, §31) — what to do when a strategy fails.
//
// Two paths, and the deterministic one comes first:
//   1. the plan's own declared fallback is used when it exists (no AI needed);
//   2. otherwise, if AI is enabled, the provider PROPOSES alternatives — which are
//      ranked by Ciel's arbitration over the evidence, not accepted on the model's word.
// Every AI-sourced proposal comes back UNCERTAIN and verification_required, and the
// reframe counter is capped by policy so Ciel cannot loop on replanning forever.
import { CielError } from '../core/types.ts';
import { arbitrate, ArbitrationOutcome } from './arbitration.ts';
import { createCognitiveContext } from '../interfaces/intelligenceProvider.ts';

export const ReframeSource = Object.freeze({
  DECLARED_FALLBACK: 'DECLARED_FALLBACK',
  AI_PROPOSAL: 'AI_PROPOSAL',
  NONE: 'NONE',
});

export function createMetaReasoner({ provider = null, config, clock, newId }) {
  const maxReframes = config.policy.max_reframes_per_mission;

  return {
    async reframe({ mission_id, task = null, goal, failure, reframes_used = 0, evidence = [], failed_strategies = [] }) {
      if (!goal || !failure) throw new CielError('INVALID_REFRAME', 'reframing requires the goal and the failure that triggered it');

      if (reframes_used >= maxReframes) {
        return { source: ReframeSource.NONE, proposal: null, decision: null, exhausted: true, reason: `reframe budget exhausted (${maxReframes})`, requires_user: true };
      }

      // 1. Deterministic: the plan said what to do instead.
      if (task && task.fallback) {
        return {
          source: ReframeSource.DECLARED_FALLBACK, proposal: task.fallback, decision: null, exhausted: false,
          requires_user: false, requires_verification: true,
          reason: 'the plan declared a fallback for this task; no model was consulted',
        };
      }

      if (!config.ai.enabled || !provider) {
        return {
          source: ReframeSource.NONE, proposal: null, decision: null, exhausted: false, requires_user: true,
          reason: 'no declared fallback and AI is disabled — Ciel stops and asks instead of improvising',
        };
      }

      // 2. AI proposes; Ciel arbitrates.
      const context = createCognitiveContext({
        goal,
        question: 'Propose alternative approaches to this goal given the failure. Each alternative must cite the evidence that supports it.',
        required_output_format: '{ "option": string, "risk": "low"|"medium"|"high", "evidence": [ { "id": string, "source": string, "level": number } ] }[] in "alternatives", best one in "decision"',
        current_state: { failure },
        failed_strategies,
        evidence,
      });

      let out;
      try {
        out = await provider.evaluate({ kind: 'analysis', context, question: context.question });
      } catch (e) {
        return { source: ReframeSource.NONE, proposal: null, decision: null, exhausted: false, requires_user: true, reason: `provider unavailable: ${e.message}` };
      }

      const candidates = [out.decision, ...(out.alternatives || [])]
        .filter((c) => c && typeof c === 'object' && typeof c.option === 'string');
      if (!candidates.length) {
        return { source: ReframeSource.NONE, proposal: null, decision: null, exhausted: false, requires_user: true, reason: 'the provider returned no usable alternative' };
      }

      const result = arbitrate({
        id: newId('decision'), mission_id, task_id: task?.id ?? null,
        question: `alternative approach after: ${failure}`,
        candidates, now: clock.now(),
      });

      if (result.outcome !== ArbitrationOutcome.DECIDED) {
        return {
          source: ReframeSource.AI_PROPOSAL, proposal: null, decision: null, exhausted: false, requires_user: true,
          ranking: result.ranking, reason: `arbitration refused to pick: ${result.reason}`,
        };
      }

      // The arbitration decision is Ciel's, but the option it ranked came from a model:
      // it stays unverified until the action actually succeeds.
      const decision = { ...result.decision, made_by: `ai:${provider.name}`, validity: 'UNCERTAIN', verification_required: true };
      return {
        source: ReframeSource.AI_PROPOSAL, proposal: decision.selected, decision, exhausted: false,
        requires_user: false, requires_verification: true, ranking: result.ranking,
        reason: 'proposed by the provider, ranked by Ciel on evidence; unverified until executed',
      };
    },
  };
}