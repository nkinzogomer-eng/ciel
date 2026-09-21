// IntelligenceProvider interface (spec §13, §38, §39, §40).
// Deliberately small: one structured entry point. The Core never sees raw text.
//
//   provider.name                 string
//   provider.isAvailable()        -> Promise<boolean>
//   provider.evaluate(request)    -> Promise<AiOutput>
//     request = { kind: 'decision'|'analysis'|'generation'|'compile_plan', context: CognitiveContext, question, output_schema }
//
// AiOutput (spec §39) — validated by validateAiOutput before the Core touches it:
//   { type, decision, alternatives[], reasoning_summary, assumptions[], evidence_needed[], risks[],
//     confidence: { reasoning: 0..1, knowledge: 0..1 } }
//
// Whatever the provider returns is a CLAIM. It becomes a hypothesis (knowledge.fromExternalClaim)
// or an UNCERTAIN decision (decision.createDecision with made_by 'ai:<name>'). Never a fact.
import { CielError } from '../core/types.ts';

export const PROVIDER_METHODS = Object.freeze(['isAvailable', 'evaluate']);
export const AI_OUTPUT_REQUIRED = Object.freeze([
  'type', 'decision', 'alternatives', 'reasoning_summary', 'assumptions', 'evidence_needed', 'risks', 'confidence',
]);

export class AiUnavailableError extends CielError {
  constructor(provider, reason) {
    super('AI_UNAVAILABLE', `intelligence provider "${provider}" unavailable: ${reason}`);
    this.name = 'AiUnavailableError';
  }
}

export function assertIntelligenceProvider(p) {
  if (!p || typeof p.name !== 'string') throw new CielError('INVALID_PROVIDER', 'provider.name is required');
  const missing = PROVIDER_METHODS.filter((m) => typeof p[m] !== 'function');
  if (missing.length) throw new CielError('INVALID_PROVIDER', `provider "${p.name}" is missing: ${missing.join(', ')}`);
  return p;
}

export function validateAiOutput(out) {
  const errors = [];
  if (typeof out === 'string') return { ok: false, errors: ['raw text output is not accepted; a structured object is required'] };
  if (!out || typeof out !== 'object') return { ok: false, errors: ['output must be an object'] };
  for (const k of AI_OUTPUT_REQUIRED) if (out[k] === undefined) errors.push(`missing field "${k}"`);
  for (const k of ['alternatives', 'assumptions', 'evidence_needed', 'risks']) {
    if (out[k] !== undefined && !Array.isArray(out[k])) errors.push(`"${k}" must be an array`);
  }
  const c = out.confidence;
  if (c && typeof c === 'object') {
    for (const k of ['reasoning', 'knowledge']) {
      if (typeof c[k] !== 'number' || c[k] < 0 || c[k] > 1) errors.push(`confidence.${k} must be a number in [0,1]`);
    }
  } else if (c !== undefined) errors.push('confidence must be an object');
  return { ok: errors.length === 0, errors };
}

// The Cognitive Context sent to a provider (spec §38): only what is relevant, never the whole mission.
export const COGNITIVE_CONTEXT_FIELDS = Object.freeze([
  'goal', 'current_state', 'relevant_facts', 'unknowns', 'constraints', 'success_criteria', 'evidence',
  'failed_strategies', 'relevant_experiences', 'question', 'required_output_format',
]);

export function createCognitiveContext(fields) {
  const unknown = Object.keys(fields).filter((k) => !COGNITIVE_CONTEXT_FIELDS.includes(k));
  if (unknown.length) throw new CielError('CONTEXT_LEAK', `cognitive context contains non-whitelisted fields: ${unknown.join(', ')}`);
  if (!fields.goal || !fields.question || !fields.required_output_format) {
    throw new CielError('INVALID_CONTEXT', 'goal, question and required_output_format are mandatory');
  }
  return Object.freeze({ ...fields });
}