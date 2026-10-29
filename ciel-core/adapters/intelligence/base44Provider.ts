// IntelligenceProvider backed by a JSON-constrained LLM call (Milestone 2).
//
// Portability: this adapter receives the raw `invokeLLM({prompt, response_json_schema, model})`
// function by injection. On Base44 that is Core.InvokeLLM; on a VPS it is an Anthropic/OpenAI
// call. The Core never learns which one it got.
//
// Honesty: the model's answer is returned as an AiOutput CLAIM. It is never promoted to a
// fact here, and a malformed answer is an error — never silently repaired.
import { AiUnavailableError, validateAiOutput } from '../../interfaces/intelligenceProvider.ts';

const AI_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    type: { type: 'string' },
    decision: {},
    alternatives: { type: 'array', items: {} },
    reasoning_summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    evidence_needed: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    confidence: {
      type: 'object',
      properties: { reasoning: { type: 'number' }, knowledge: { type: 'number' } },
      required: ['reasoning', 'knowledge'],
    },
  },
  required: ['type', 'decision', 'alternatives', 'reasoning_summary', 'assumptions', 'evidence_needed', 'risks', 'confidence'],
});

// Some model APIs drop nested content when a field has no declared type, so callers pass
// a typed schema for `decision` when the answer has a precise shape (e.g. a mission plan).
export function aiOutputSchema(decisionSchema) {
  return {
    ...AI_OUTPUT_SCHEMA,
    properties: { ...AI_OUTPUT_SCHEMA.properties, decision: decisionSchema },
  };
}

function renderPrompt(request) {
  const c = request.context;
  const lines = [
    'You are the reasoning component of Ciel, a cognitive system that verifies everything you say.',
    'Your answer is treated as an UNVERIFIED CLAIM: state assumptions and missing evidence instead of guessing.',
    '',
    `TASK KIND: ${request.kind}`,
    `GOAL: ${c.goal}`,
    `QUESTION: ${c.question}`,
    `REQUIRED OUTPUT: ${c.required_output_format}`,
  ];
  const optional = ['current_state', 'relevant_facts', 'unknowns', 'constraints', 'success_criteria', 'evidence', 'failed_strategies', 'relevant_experiences'];
  for (const k of optional) {
    if (c[k] !== undefined && c[k] !== null && (!Array.isArray(c[k]) || c[k].length)) {
      lines.push(`${k.toUpperCase()}: ${JSON.stringify(c[k])}`);
    }
  }
  lines.push('', 'Answer with the required JSON object only. "decision" holds the answer in the required output format.');
  return lines.join('\n');
}

export function createLlmProvider({ name = 'base44-llm', invokeLLM, model = null, available = true }) {
  if (typeof invokeLLM !== 'function') throw new AiUnavailableError(name, 'no invokeLLM function was injected');
  let calls = 0;
  const lastErrors = [];

  return {
    name,
    async isAvailable() { return available; },
    callCount() { return calls; },
    errors() { return [...lastErrors]; },

    async evaluate(request) {
      if (!available) throw new AiUnavailableError(name, 'provider marked unavailable');
      calls += 1;
      let raw;
      try {
        raw = await invokeLLM({
          prompt: renderPrompt(request),
          response_json_schema: request.output_schema
            || (request.decision_schema ? aiOutputSchema(request.decision_schema) : AI_OUTPUT_SCHEMA),
          ...(model ? { model } : {}),
        });
      } catch (e) {
        lastErrors.push(e.message);
        throw new AiUnavailableError(name, e.message);
      }
      const v = validateAiOutput(raw);
      if (!v.ok) {
        lastErrors.push(v.errors.join('; '));
        // A provider that breaks the contract is unavailable, not "close enough".
        throw new AiUnavailableError(name, `output contract violated: ${v.errors.join('; ')}`);
      }
      return raw;
    },
  };
}