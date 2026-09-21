// Structured Mission Plan (amendment 4.6).
// A plan in this format is executable by Ciel with NO AI. Natural language -> plan is
// a separate, optional step (Milestone 2).
import { CielError } from '../core/types.ts';
import { createMission, createTask } from './mission.ts';

export const PLAN_FORMAT_VERSION = 1;

// The plan format as a JSON schema, so a provider can be constrained to emit exactly this.
// validatePlan remains the authority: this schema only shapes the request.
export const PLAN_JSON_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    goal: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          goal: { type: 'string' },
          // params travel as a JSON string: free-form objects are not preserved by every
          // structured-output API. The synthesizer parses it back before validation.
          action: {
            type: 'object',
            properties: { capability: { type: 'string' }, params_json: { type: 'string' } },
            required: ['capability', 'params_json'],
          },
          dependencies: { type: 'array', items: { type: 'string' } },
          verification: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['PREDICATE'] },
              predicate: {
                type: 'object',
                properties: { path: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] }, value: {} },
                required: ['path', 'op'],
              },
            },
            required: ['kind', 'predicate'],
          },
        },
        required: ['id', 'goal', 'action', 'dependencies', 'verification'],
      },
    },
  },
  required: ['goal', 'tasks'],
});

export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan must be an object'] };
  if (typeof plan.goal !== 'string' || !plan.goal.trim()) errors.push('goal must be a non-empty string');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) errors.push('tasks must be a non-empty array');
  else {
    const ids = new Set();
    for (const [i, t] of plan.tasks.entries()) {
      const label = `tasks[${i}]`;
      if (!t || typeof t.id !== 'string' || !t.id) errors.push(`${label}.id must be a string`);
      else if (ids.has(t.id)) errors.push(`${label}.id "${t.id}" is duplicated`);
      else ids.add(t.id);
      if (!t || !t.action || typeof t.action.capability !== 'string') errors.push(`${label}.action.capability must be a string`);
      if (t && t.action && t.action.params !== undefined && (typeof t.action.params !== 'object' || t.action.params === null)) {
        errors.push(`${label}.action.params must be an object`);
      }
      if (t && t.dependencies !== undefined && !Array.isArray(t.dependencies)) errors.push(`${label}.dependencies must be an array`);
      if (t && t.success_conditions !== undefined && !Array.isArray(t.success_conditions)) errors.push(`${label}.success_conditions must be an array`);
    }
    for (const t of plan.tasks) {
      for (const d of (t && Array.isArray(t.dependencies) ? t.dependencies : [])) {
        if (d === t.id) errors.push(`task "${t.id}" depends on itself`);
        else if (!ids.has(d)) errors.push(`task "${t.id}" depends on unknown task "${d}"`);
      }
    }
    if (errors.length === 0) {
      try { topologicalOrder(plan.tasks); } catch (e) { errors.push(e.message); }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function topologicalOrder(tasks) {
  const indeg = new Map(tasks.map((t) => [t.id, 0]));
  const out = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const d of (t.dependencies || [])) { indeg.set(t.id, indeg.get(t.id) + 1); out.get(d).push(t.id); }
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const n of out.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) queue.push(n); }
  }
  if (order.length !== tasks.length) {
    throw new CielError('PLAN_CYCLE', 'plan contains a dependency cycle', { unresolved: tasks.filter((t) => !order.includes(t.id)).map((t) => t.id) });
  }
  return order;
}

// Pure instantiation of a plan into mission + tasks. The Mission Compiler (Phase C)
// wraps this with intake classification and ledger events.
export function instantiatePlan(plan, { missionId, newId, now, source = 'structured_plan' }) {
  const v = validatePlan(plan);
  if (!v.ok) throw new CielError('INVALID_PLAN', 'plan is invalid', v.errors);
  const mission = createMission({ id: missionId, goal: plan.goal, source, plan_id: plan.id || null, now });
  const taskIdMap = new Map(plan.tasks.map((t) => [t.id, newId('task')]));
  const tasks = plan.tasks.map((t) => createTask({
    id: taskIdMap.get(t.id), mission_id: missionId, goal: t.goal || t.id,
    action: t.action,
    dependencies: (t.dependencies || []).map((d) => taskIdMap.get(d)),
    preconditions: t.preconditions || [], expected_output: t.expected_output ?? null,
    success_conditions: t.success_conditions || [], verification: t.verification || null,
    fallback: t.fallback || null, now,
  }));
  return { mission, tasks, plan_task_ids: Object.fromEntries(taskIdMap) };
}