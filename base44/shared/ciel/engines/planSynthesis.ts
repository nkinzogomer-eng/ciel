// Plan Synthesis (Milestone 2) — prose → structured plan, via an IntelligenceProvider.
//
// The model only ever PROPOSES. Ciel then applies its own deterministic gates:
//   1. the plan must satisfy validatePlan (shape, ids, dependencies, no cycle)
//   2. every capability must be registered — no invented tools
//   3. the params of each task must be objects
// A proposal that fails any gate is rejected with the reasons; it is never patched up.
// A surviving proposal is flagged ai_authored and requires user confirmation before it runs.
import { CielError } from '../core/types.ts';
import { validatePlan } from '../domain/plan.ts';
import { createCognitiveContext } from '../interfaces/intelligenceProvider.ts';
import { PLAN_JSON_SCHEMA } from '../domain/plan.ts';
import { fromExternalClaim } from '../domain/confidence.ts';

export const SynthesisOutcome = Object.freeze({
  PROPOSED: 'PROPOSED',
  REJECTED: 'REJECTED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
});

export function createPlanSynthesizer({ provider = null, registry, config }) {
  return {
    async synthesize(prose, { constraints = [], success_criteria = [] } = {}) {
      if (!prose || !String(prose).trim()) throw new CielError('EMPTY_REQUEST', 'nothing to synthesize a plan from');
      if (!config.ai.enabled || !provider) {
        return {
          outcome: SynthesisOutcome.AI_UNAVAILABLE, plan: null, errors: [],
          reason: 'AI is disabled; Ciel accepts a structured plan instead of inventing one',
          requires: ['a structured mission plan, or ai.enabled with a provider'],
        };
      }

      const catalogue = registry.list().map((m) => ({
        capability: m.name, description: m.description,
        idempotent: m.idempotent, reversible: m.reversible, permissions: m.permissions,
      }));

      const context = createCognitiveContext({
        goal: String(prose).trim(),
        question: 'Produce a structured mission plan that reaches this goal using ONLY the listed capabilities.',
        required_output_format: '{ "goal": string, "tasks": [ { "id": string, "goal": string, "action": { "capability": string, "params": object }, "dependencies": string[], "verification": { "kind": "PREDICATE", "predicate": { "path": string, "op": "eq", "value": any } } | null } ] }',
        constraints: [...constraints, 'use only the capabilities listed in current_state.capabilities', 'no task may depend on an id that is not in the plan'],
        success_criteria,
        current_state: { capabilities: catalogue },
        unknowns: ['the real world state is unknown to you; Ciel verifies every task result itself'],
      });

      let out;
      try {
        // The expected shape of `decision` is declared, so a provider cannot answer with prose.
        out = await provider.evaluate({ kind: 'compile_plan', context, question: context.question, decision_schema: PLAN_JSON_SCHEMA });
      } catch (e) {
        return { outcome: SynthesisOutcome.AI_UNAVAILABLE, plan: null, errors: [e.message], reason: e.message, requires: ['a reachable provider, or a structured plan'] };
      }

      const { plan, parse_errors } = decodeParams(out.decision);
      const v = validatePlan(plan);
      if (parse_errors.length) v.errors.push(...parse_errors);
      const errors = [...v.errors];
      if (v.ok && !parse_errors.length) {
        const missing = registry.missing(plan.tasks.map((t) => t.action.capability));
        if (missing.length) errors.push(`unknown capabilities: ${missing.join(', ')}`);
      }
      if (errors.length) {
        return { outcome: SynthesisOutcome.REJECTED, plan: null, errors, reason: 'the proposed plan did not pass Ciel\'s own validation', provenance: provenanceOf(provider, out) };
      }

      return {
        outcome: SynthesisOutcome.PROPOSED,
        plan,
        errors: [],
        ai_authored: true,
        requires_confirmation: true, // an AI-written plan is never executed unattended
        provenance: provenanceOf(provider, out),
        reason: 'plan proposed by the provider and validated against the capability registry',
      };
    },
  };
}

// Shape decoding only: action.params_json (a string, per the request schema) becomes
// action.params. A string that is not valid JSON is an error, never an empty params object.
function decodeParams(proposal) {
  const parse_errors = [];
  if (!proposal || !Array.isArray(proposal.tasks)) return { plan: proposal, parse_errors };
  const tasks = proposal.tasks.map((t, i) => {
    const action = t?.action;
    if (!action || typeof action.params_json !== 'string') return t;
    let params;
    try {
      params = JSON.parse(action.params_json);
    } catch (_) {
      parse_errors.push(`tasks[${i}].action.params_json is not valid JSON`);
      return t;
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      parse_errors.push(`tasks[${i}].action.params_json must decode to an object`);
      return t;
    }
    const { params_json, ...rest } = action;
    return { ...t, action: { ...rest, params } };
  });
  return { plan: { ...proposal, tasks }, parse_errors };
}

function provenanceOf(provider, out) {
  return {
    made_by: `ai:${provider.name}`,
    reasoning_summary: out.reasoning_summary,
    assumptions: out.assumptions,
    evidence_needed: out.evidence_needed,
    risks: out.risks,
    // Claimed confidence is recorded as a claim; Ciel's own confidence stays at zero
    // until the tasks actually run and are verified.
    confidence: fromExternalClaim(out.confidence),
  };
}