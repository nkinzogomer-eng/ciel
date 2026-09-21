// Mission Compiler (spec §27, amendment 4.6) — Phase C. No AI involved.
// A plan only compiles when every capability it needs actually exists: an unknown
// capability is a compile-time refusal, not a mid-mission surprise.
import { CielError, LedgerEventType, MissionStatus } from '../core/types.ts';
import { validatePlan, topologicalOrder, instantiatePlan } from '../domain/plan.ts';
import { transitionMission } from '../domain/mission.ts';
import { createBudget } from '../domain/budget.ts';

export function createMissionCompiler({ store, clock, newId, ledger, registry, config }) {
  return {
    async compile(plan, { mission_id = null, source = 'structured_plan', limits = null, deadline = null } = {}) {
      const v = validatePlan(plan);
      if (!v.ok) throw new CielError('INVALID_PLAN', 'plan is invalid', v.errors);

      const missing = registry.missing(plan.tasks.map((t) => t.action.capability));
      if (missing.length) {
        throw new CielError('UNKNOWN_CAPABILITY', `plan requires capabilities that are not registered: ${missing.join(', ')}`, missing);
      }
      // Permission/runtime problems are reported now but do not fake a failure: the
      // executor blocks the individual task with the reason.
      const warnings = plan.tasks
        .map((t) => ({ task: t.id, capability: t.action.capability, ...registry.check(t.action.capability) }))
        .filter((c) => !c.allowed);

      const id = mission_id || newId('mission');
      const { mission: created, tasks, plan_task_ids } = instantiatePlan(plan, { missionId: id, newId, now: clock.now(), source });

      await store.put('missions', created);
      for (const t of tasks) await store.put('tasks', t);
      await ledger.append(id, LedgerEventType.mission_created, { goal: plan.goal, task_count: tasks.length, source });

      const budget = createBudget({
        id: newId('budget'), mission_id: id,
        limits: limits || config.budget.default_limits, deadline, now: clock.now(),
      });
      await store.put('budgets', budget);

      const mission = transitionMission(created, MissionStatus.COMPILED, { now: clock.now(), reason: 'plan compiled' });
      await store.put('missions', mission);
      await ledger.append(id, LedgerEventType.mission_compiled, {
        plan_task_ids, execution_order: topologicalOrder(plan.tasks), permission_warnings: warnings,
      });

      return { mission, tasks, budget, plan_task_ids, warnings };
    },
  };
}