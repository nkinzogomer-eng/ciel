// Mission Graph Executor (spec §27, §30, §31, §32, §33) — Phase C, deterministic, no AI.
//
// Per task, in this exact order:
//   budget assessment -> capability/permission check -> action plan (risk + replay policy)
//   -> confirmation gate for irreversible actions -> precondition re-check
//   -> checkpoint WITH the in-flight action -> execute -> observation + integrity
//   -> evidence -> verification -> state invalidation cascade -> loop detection
//   -> checkpoint cleared.
//
// Nothing here guesses: a missing capability, a failed precondition, an unverifiable
// result or an exhausted budget each produce an explicit, recorded state.
import {
  CielError, LedgerEventType, MissionStatus, TaskStatus, VerificationState, BudgetDecision,
} from '../core/types.ts';
import { fingerprint } from '../core/fingerprint.ts';
import { transitionMission, transitionTask, readyTasks, missionOutcome, isTerminal } from '../domain/mission.ts';
import { createActionPlan, RiskClass } from '../domain/actionGraph.ts';
import { createObservation, assessIntegrity, observationToEvidence } from '../domain/evidence.ts';
import { consume, assessBudget, operationAllowed } from '../domain/budget.ts';
import { checkPreconditions, applyInvalidation } from './invalidation.ts';

export function createExecutor({ store, clock, newId, ledger, checkpoints, registry, verifier, loop, config, learning = null }) {
  const replace = (tasks, task) => tasks.map((t) => (t.id === task.id ? task : t));

  async function persist(mission, tasks, budget) {
    await store.put('missions', mission);
    for (const t of tasks) await store.put('tasks', t);
    if (budget) await store.put('budgets', budget);
  }

  async function cascade(mission_id, affected_state, now) {
    const items = [...await store.find('knowledge', {}), ...await store.find('decisions', { mission_id })];
    if (!items.length) return [];
    const { invalidated_ids, items: updated } = applyInvalidation(items, affected_state, { reason: `state changed: ${affected_state.join(', ')}`, now });
    for (const it of updated) {
      if (!invalidated_ids.includes(it.id)) continue;
      await store.put(it.level !== undefined ? 'knowledge' : 'decisions', it);
    }
    if (invalidated_ids.length) {
      await ledger.append(mission_id, LedgerEventType.state_invalidated, { affected_state, invalidated_ids });
    }
    return invalidated_ids;
  }

  async function run(mission_id, { world = null, observe = null, humanAnswers = {}, confirmations = {}, maxSteps = 50 } = {}) {
    let mission = await store.get('missions', mission_id);
    if (!mission) throw new CielError('UNKNOWN_MISSION', `mission ${mission_id} does not exist`);
    let tasks = await store.find('tasks', { mission_id });
    let budget = (await store.find('budgets', { mission_id }))[0] || null;
    const steps = [];
    let truncated = false;

    if (isTerminal(mission)) {
      return { mission, tasks, budget, steps, truncated, outcome: mission.status, question: null, ledger: await ledger.summary(mission_id) };
    }

    if (mission.status === MissionStatus.WAITING_FOR_USER) {
      await ledger.append(mission_id, LedgerEventType.user_answer_received, { confirmations: Object.keys(confirmations), attestations: Object.keys(humanAnswers) });
      mission = transitionMission(mission, MissionStatus.RUNNING, { now: clock.now(), reason: 'user input received' });
      tasks = tasks.map((t) => (t.status === TaskStatus.WAITING_FOR_USER && (confirmations[t.id] || humanAnswers[t.id])
        ? transitionTask(t, TaskStatus.READY, { now: clock.now(), reason: 'user responded' }) : t));
    } else if (mission.status === MissionStatus.COMPILED) {
      mission = transitionMission(mission, MissionStatus.RUNNING, { now: clock.now(), reason: 'execution started' });
    }

    while (steps.length < maxSteps) {
      // --- budget ---------------------------------------------------------
      const assessment = assessBudget(budget, { now: clock.now(), soft_threshold: config.budget.soft_threshold });
      if (assessment.decision !== BudgetDecision.CONTINUE) {
        await ledger.append(mission_id, LedgerEventType.budget_assessed, { decision: assessment.decision, reasons: assessment.reasons });
      }
      if (!operationAllowed(assessment, 'execution')) {
        mission = transitionMission(mission, MissionStatus.BLOCKED, { now: clock.now(), reason: `budget: ${assessment.reasons.join('; ')}` });
        await ledger.append(mission_id, LedgerEventType.mission_blocked, { cause: 'budget', reasons: assessment.reasons });
        break;
      }

      // --- pick the next task (plan order, dependencies satisfied) ---------
      let task = tasks.find((t) => t.status === TaskStatus.READY) || readyTasks(tasks)[0];
      if (!task) {
        // Nothing is runnable. If work remains, it is blocked on dependencies that were
        // never satisfied (typically an UNVERIFIED result). Say so instead of hanging.
        const stalled = tasks.filter((t) => t.status === TaskStatus.PENDING);
        if (stalled.length) {
          mission = transitionMission(mission, MissionStatus.BLOCKED, {
            now: clock.now(),
            reason: `${stalled.length} task(s) depend on results that are not verified; continuing would build on an unverified result`,
          });
          await ledger.append(mission_id, LedgerEventType.mission_blocked, { cause: 'unsatisfied_dependencies', task_ids: stalled.map((t) => t.id) });
        }
        break;
      }
      if (task.status === TaskStatus.PENDING) {
        task = transitionTask(task, TaskStatus.READY, { now: clock.now(), reason: 'dependencies satisfied' });
        tasks = replace(tasks, task);
      }

      const capabilityName = task.action.capability;
      const check = registry.check(capabilityName);
      if (!check.allowed) {
        task = transitionTask(task, TaskStatus.BLOCKED, { now: clock.now(), reason: check.reason });
        tasks = replace(tasks, task);
        await ledger.append(mission_id, LedgerEventType.diagnostic_recorded, { cause: check.code, capability: capabilityName, reason: check.reason }, { task_id: task.id });
        steps.push({ task_id: task.id, capability: capabilityName, result: 'BLOCKED', reason: check.reason });
        continue;
      }

      const cap = registry.get(capabilityName);
      const { manifest } = cap;
      let actionPlan;
      try {
        actionPlan = createActionPlan({
          id: newId('act'), task_id: task.id, action: task.action, manifest,
          preconditions: task.preconditions, dependencies: task.dependencies,
          affected_state: registry.affectedState(capabilityName, task.action.params),
          expected_observations: task.expected_output ? [task.expected_output] : [],
          verification: task.verification, rollback: task.fallback?.rollback ?? null, now: clock.now(),
        });
      } catch (e) {
        task = transitionTask(task, TaskStatus.BLOCKED, { now: clock.now(), reason: `action plan refused: ${e.message}` });
        tasks = replace(tasks, task);
        await ledger.append(mission_id, LedgerEventType.diagnostic_recorded, { cause: e.code || 'ACTION_PLAN_REFUSED', reason: e.message }, { task_id: task.id });
        steps.push({ task_id: task.id, capability: capabilityName, result: 'BLOCKED', reason: e.message });
        continue;
      }
      await store.put('action_plans', actionPlan);

      // --- irreversible actions need explicit authorization ----------------
      if (actionPlan.risk_class === RiskClass.IRREVERSIBLE && config.policy.require_confirmation_for_irreversible && !confirmations[task.id]) {
        task = transitionTask(task, TaskStatus.WAITING_FOR_USER, { now: clock.now(), reason: 'irreversible action awaiting authorization' });
        tasks = replace(tasks, task);
        const question = {
          text: `Authorize the irreversible action "${capabilityName}" affecting ${actionPlan.affected_state.join(', ')}?`,
          why_needed: 'This action cannot be undone and no rollback is declared. Ciel does not perform irreversible actions without explicit authorization.',
          task_id: task.id,
        };
        mission = transitionMission(mission, MissionStatus.WAITING_FOR_USER, { now: clock.now(), reason: 'authorization required', question });
        await ledger.append(mission_id, LedgerEventType.user_question_asked, question, { task_id: task.id });
        steps.push({ task_id: task.id, capability: capabilityName, result: 'WAITING_FOR_USER', reason: 'authorization required' });
        break;
      }

      // --- preconditions ---------------------------------------------------
      const pc = await checkPreconditions(task.preconditions || [], observe);
      if (!pc.ok) {
        await ledger.append(mission_id, LedgerEventType.state_invalidated, { cause: 'precondition', failed: pc.failed }, { task_id: task.id });
        task = transitionTask(task, TaskStatus.BLOCKED, { now: clock.now(), reason: `preconditions not met: ${pc.failed.map((f) => f.reason).join('; ')}` });
        tasks = replace(tasks, task);
        steps.push({ task_id: task.id, capability: capabilityName, result: 'BLOCKED', reason: 'preconditions not met' });
        continue;
      }

      // --- checkpoint BEFORE acting (this is what makes recovery possible) --
      task = transitionTask(task, TaskStatus.RUNNING, { now: clock.now(), reason: 'executing' });
      tasks = replace(tasks, task);
      await checkpoints.save({
        mission, tasks,
        in_flight_actions: [{
          task_id: task.id, capability: capabilityName, params: task.action.params,
          idempotent: manifest.idempotent, started_at: clock.now(),
          effect_probe: typeof cap.probeEffect === 'function' ? 'available' : null,
        }],
      });
      await ledger.append(mission_id, LedgerEventType.action_started, {
        capability: capabilityName, params: task.action.params,
        risk_class: actionPlan.risk_class, replay_policy: actionPlan.replay_policy,
      }, { task_id: task.id });

      // --- execute ----------------------------------------------------------
      const startedAt = Date.parse(clock.now());
      let result;
      try {
        result = await cap.execute(task.action.params, { clock, mission_id, task_id: task.id, world, policy: config.policy });
      } catch (e) {
        budget = consume(budget, { tool_calls: 1, time_ms: Math.max(0, Date.parse(clock.now()) - startedAt) }, clock.now());
        await ledger.append(mission_id, LedgerEventType.diagnostic_recorded, { cause: e.code || 'EXECUTION_ERROR', capability: capabilityName, error: e.message }, { task_id: task.id });
        task = transitionTask(task, TaskStatus.FAILED, { now: clock.now(), reason: `execution error: ${e.message}` });
        tasks = replace(tasks, task);
        await checkpoints.save({ mission, tasks, in_flight_actions: [] });
        steps.push({ task_id: task.id, capability: capabilityName, result: 'FAILED', reason: e.message });
        continue;
      }
      budget = consume(budget, { tool_calls: 1, time_ms: Math.max(0, Date.parse(clock.now()) - startedAt) }, clock.now());
      await ledger.append(mission_id, LedgerEventType.tool_called, { capability: capabilityName, idempotent: manifest.idempotent }, { task_id: task.id });

      // --- observation -> integrity -> evidence -----------------------------
      let observation = createObservation({
        id: newId('obs'), task_id: task.id, capability: capabilityName, params: task.action.params,
        output: result.output,
        state_fingerprint: result.observed_state !== undefined ? await fingerprint(result.observed_state) : null,
        now: clock.now(),
      });
      observation = assessIntegrity(observation, verifier.integrityChecks(observation, { manifest, expected_output: task.expected_output }));
      await store.put('observations', observation);
      const evidence = observationToEvidence(observation, { id: newId('ev'), now: clock.now() });
      await store.put('evidence', evidence);
      await ledger.append(mission_id, LedgerEventType.observation_received, { observation_id: observation.id, integrity: observation.integrity.status }, { task_id: task.id });

      // --- verification ------------------------------------------------------
      const v = await verifier.verify({
        subject_id: task.id, subject_type: 'task', spec: task.verification, output: result.output,
        evidence_ids: [evidence.id], produced_by: capabilityName, mission_id,
        humanAnswer: humanAnswers[task.id] ?? null, world,
      });
      await store.put('verifications', v.record);

      if (v.needs_human) {
        task = transitionTask(task, TaskStatus.WAITING_FOR_USER, { now: clock.now(), reason: 'human attestation required' });
        tasks = replace(tasks, task);
        const question = { text: v.question, why_needed: 'Only a human can attest this result; Ciel will not mark it verified on its own.', task_id: task.id };
        mission = transitionMission(mission, MissionStatus.WAITING_FOR_USER, { now: clock.now(), reason: 'human attestation required', question });
        await ledger.append(mission_id, LedgerEventType.user_question_asked, question, { task_id: task.id });
        await checkpoints.save({ mission, tasks, in_flight_actions: [] });
        steps.push({ task_id: task.id, capability: capabilityName, result: 'WAITING_FOR_USER', reason: 'human attestation required' });
        break;
      }

      if (v.state === VerificationState.CONTRADICTED) {
        task = transitionTask(task, TaskStatus.FAILED, { now: clock.now(), reason: `verification contradicted the result: ${v.record.contradictions.join('; ')}` });
      } else {
        task = transitionTask(task, TaskStatus.SUCCEEDED, { now: clock.now(), reason: 'capability returned a result' });
        task = transitionTask(
          { ...task, verification_record_id: v.record.id, observation_ids: [...task.observation_ids, observation.id] },
          v.state === VerificationState.VERIFIED ? TaskStatus.VERIFIED : TaskStatus.UNVERIFIED,
          { now: clock.now(), reason: `verification: ${v.state} (${v.record.verifier_kind || 'no applicable verifier'})` },
        );
      }
      tasks = replace(tasks, task);
      await ledger.append(mission_id, LedgerEventType.verification_completed, { state: v.state, verifier_kind: v.record.verifier_kind, notes: v.record.notes }, { task_id: task.id });

      // --- consequences: invalidate what depended on the changed state -------
      if (actionPlan.risk_class !== RiskClass.PURE) {
        await cascade(mission_id, actionPlan.affected_state, clock.now());
      }

      if (learning) {
        await learning.recordTaskOutcome({
          mission, task, observation, verification: v.record,
          cost: { tool_calls: 1 }, context: { capability: capabilityName, risk_class: actionPlan.risk_class },
        });
      }

      // --- loop detection ----------------------------------------------------
      const l = await loop.record({ capability: capabilityName, params: task.action.params, outcome: result.output });
      await checkpoints.save({ mission, tasks, in_flight_actions: [] });
      steps.push({ task_id: task.id, capability: capabilityName, result: task.status, verification: v.state });

      if (l.looping) {
        await ledger.append(mission_id, LedgerEventType.loop_detected, { kind: l.kind, count: l.count, signature: l.signature, reason: l.reason });
        mission = transitionMission(mission, MissionStatus.BLOCKED, { now: clock.now(), reason: `loop detected: ${l.reason}` });
        await ledger.append(mission_id, LedgerEventType.mission_blocked, { cause: 'loop', kind: l.kind });
        break;
      }
    }

    if (steps.length >= maxSteps) {
      truncated = true;
      await ledger.append(mission_id, LedgerEventType.diagnostic_recorded, { cause: 'MAX_STEPS_REACHED', max_steps: maxSteps });
    }

    // --- honest final state ------------------------------------------------
    if (!isTerminal(mission) && mission.status === MissionStatus.RUNNING && !truncated) {
      const outcome = missionOutcome(tasks);
      if (outcome && outcome !== MissionStatus.WAITING_FOR_USER) {
        mission = transitionMission(mission, outcome, { now: clock.now(), reason: 'all tasks resolved' });
        const type = outcome === MissionStatus.FAILED ? LedgerEventType.mission_failed
          : outcome === MissionStatus.BLOCKED ? LedgerEventType.mission_blocked
            : LedgerEventType.mission_completed;
        await ledger.append(mission_id, type, { status: outcome, tasks: tasks.map((t) => ({ id: t.id, status: t.status })) });
      }
    }

    await persist(mission, tasks, budget);
    return {
      mission, tasks, budget, steps, truncated,
      outcome: mission.status, question: mission.pending_question,
      ledger: await ledger.summary(mission_id),
    };
  }

  return { run };
}