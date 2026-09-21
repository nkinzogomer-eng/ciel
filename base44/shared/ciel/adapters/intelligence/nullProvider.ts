// Intelligence adapters that need no AI.
//   createNullProvider  — the AI_ENABLED=false provider: never available, every call is counted and refused.
//   createMockProvider  — scripted answers for tests (Phase D: "wrong AI answer is rejected by verification").
// The real Anthropic adapter is Milestone 2 and will sit next to these files.
import { AiUnavailableError } from '../../interfaces/intelligenceProvider.ts';

export function createNullProvider() {
  let calls = 0;
  return {
    name: 'none',
    async isAvailable() { return false; },
    async evaluate() { calls += 1; throw new AiUnavailableError('none', 'AI is disabled (ai.enabled=false)'); },
    callCount() { return calls; },
  };
}

export function createMockProvider({ name = 'mock', responses = [], available = true } = {}) {
  let calls = 0;
  const requests = [];
  return {
    name,
    async isAvailable() { return available; },
    async evaluate(request) {
      calls += 1;
      requests.push(request);
      if (!available) throw new AiUnavailableError(name, 'mock marked unavailable');
      const r = responses[Math.min(calls - 1, responses.length - 1)];
      if (r === undefined) throw new AiUnavailableError(name, 'no scripted response');
      return typeof r === 'function' ? r(request) : r;
    },
    callCount() { return calls; },
    requests() { return [...requests]; },
  };
}