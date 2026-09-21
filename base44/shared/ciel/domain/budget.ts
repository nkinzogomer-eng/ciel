// Cognitive Budget (spec §32). CPU/RAM are declared but not tracked here (REQUIRES_EXTERNAL_RUNTIME).
import { CielError, BudgetDecision } from '../core/types.ts';

export const BUDGET_DIMENSIONS = Object.freeze(['time_ms', 'tokens', 'money', 'tool_calls', 'ai_calls']);
export const UNTRACKED_DIMENSIONS = Object.freeze(['cpu', 'ram']);
// Operations that must never be skipped to save budget.
export const PROTECTED_OPERATIONS = Object.freeze(['verification']);

export function createBudget({ id, mission_id, limits = {}, deadline = null, now }) {
  if (!id || !mission_id) throw new CielError('MISSING_ID', 'budget id and mission_id are required');
  for (const [k, v] of Object.entries(limits)) {
    if (!BUDGET_DIMENSIONS.includes(k)) throw new CielError('UNKNOWN_DIMENSION', `unknown budget dimension "${k}"`);
    if (typeof v !== 'number' || v < 0) throw new CielError('INVALID_LIMIT', `limit ${k} must be a number >= 0`);
  }
  return {
    id, mission_id, limits: { ...limits }, used: Object.fromEntries(BUDGET_DIMENSIONS.map((d) => [d, 0])),
    deadline, protected_operations: [...PROTECTED_OPERATIONS], created_at: now, updated_at: now,
  };
}

export function consume(budget, usage, now) {
  const used = { ...budget.used };
  for (const [k, v] of Object.entries(usage)) {
    if (!BUDGET_DIMENSIONS.includes(k)) throw new CielError('UNKNOWN_DIMENSION', `unknown budget dimension "${k}"`);
    if (typeof v !== 'number' || v < 0) throw new CielError('INVALID_USAGE', `usage ${k} must be >= 0`);
    used[k] += v;
  }
  return { ...budget, used, updated_at: now };
}

// Ratio used/limit per dimension; null when the dimension is unlimited (no limit set).
export function utilization(budget) {
  return Object.fromEntries(BUDGET_DIMENSIONS.map((d) => {
    const limit = budget.limits[d];
    return [d, limit === undefined ? null : (limit === 0 ? (budget.used[d] > 0 ? Infinity : 0) : budget.used[d] / limit)];
  }));
}

export function assessBudget(budget, { now, soft_threshold = 0.8 }) {
  const reasons = [];
  if (budget.deadline && Date.parse(now) >= Date.parse(budget.deadline)) reasons.push('deadline reached');
  const u = utilization(budget);
  const exhausted = BUDGET_DIMENSIONS.filter((d) => u[d] !== null && u[d] >= 1);
  const near = BUDGET_DIMENSIONS.filter((d) => u[d] !== null && u[d] >= soft_threshold && u[d] < 1);
  if (exhausted.length) reasons.push(`exhausted: ${exhausted.join(', ')}`);
  if (near.length) reasons.push(`near limit: ${near.join(', ')}`);
  let decision = BudgetDecision.CONTINUE;
  if (reasons.some((r) => r.startsWith('deadline')) || exhausted.length) decision = BudgetDecision.STOP;
  else if (near.length) decision = BudgetDecision.REDUCE_SCOPE;
  return { decision, reasons, utilization: u };
}

// Even when STOP is decided, a protected operation (verification) is still allowed to run.
export function operationAllowed(assessment, operation) {
  if (PROTECTED_OPERATIONS.includes(operation)) return true;
  return assessment.decision !== BudgetDecision.STOP && assessment.decision !== BudgetDecision.BLOCKED;
}