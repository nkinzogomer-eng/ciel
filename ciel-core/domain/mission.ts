// Mission and Task models (spec §27, §55, amendment 4.3).
import {
  CielError, MissionStatus, TaskStatus, MISSION_TRANSITIONS, TASK_TRANSITIONS, MISSION_TERMINAL,
  assertTransition, assertOneOf, IntakeKind,
} from '../core/types.ts';

export function createMission({ id, goal, source = 'user', intake_kind = IntakeKind.MISSION, plan_id = null, now }) {
  if (!id) throw new CielError('MISSING_ID', 'mission id is required');
  if (!goal || typeof goal !== 'string') throw new CielError('INVALID_GOAL', 'mission goal must be a non-empty string');
  assertOneOf(IntakeKind, intake_kind, 'intake_kind');
  return {
    id, goal, source, intake_kind, plan_id,
    status: MissionStatus.CREATED,
    status_history: [{ status: MissionStatus.CREATED, at: now, reason: 'created' }],
    pending_question: null,
    final_report: null,
    created_at: now, updated_at: now,
  };
}

export function createTask({
  id, mission_id, goal, action, dependencies = [], preconditions = [], expected_output = null,
  success_conditions = [], verification = null, fallback = null, now,
}) {
  if (!id || !mission_id) throw new CielError('MISSING_ID', 'task id and mission_id are required');
  if (!action || typeof action.capability !== 'string') {
    throw new CielError('INVALID_ACTION', `task ${id}: action.capability must be a string`);
  }
  return {
    id, mission_id, goal: goal || '',
    action: { capability: action.capability, params: action.params || {} },
    preconditions, dependencies, expected_output, success_conditions, verification, fallback,
    status: TaskStatus.PENDING,
    status_history: [{ status: TaskStatus.PENDING, at: now, reason: 'created' }],
    attempts: 0,
    observation_ids: [], decision_ids: [], verification_record_id: null,
    created_at: now, updated_at: now,
  };
}

export function transitionTask(task, to, { now, reason = '' }) {
  assertTransition(TASK_TRANSITIONS, task.status, to, `task ${task.id}`);
  return {
    ...task, status: to, updated_at: now,
    attempts: to === TaskStatus.RUNNING ? task.attempts + 1 : task.attempts,
    status_history: [...task.status_history, { status: to, at: now, reason }],
  };
}

// Entering WAITING_FOR_USER requires the question AND why the answer is needed (amendment 4.3).
export function transitionMission(mission, to, { now, reason = '', question = null }) {
  assertTransition(MISSION_TRANSITIONS, mission.status, to, `mission ${mission.id}`);
  const next = {
    ...mission, status: to, updated_at: now,
    status_history: [...mission.status_history, { status: to, at: now, reason }],
  };
  if (to === MissionStatus.WAITING_FOR_USER) {
    if (!question || !question.text || !question.why_needed) {
      throw new CielError('QUESTION_REQUIRED', 'WAITING_FOR_USER requires { text, why_needed }');
    }
    next.pending_question = { ...question, asked_at: now, answer: null };
  } else if (mission.status === MissionStatus.WAITING_FOR_USER) {
    next.pending_question = null;
  }
  return next;
}

export function isTerminal(mission) {
  return MISSION_TERMINAL.has(mission.status);
}

const SATISFIED = new Set([TaskStatus.SUCCEEDED, TaskStatus.VERIFIED]);

// Tasks whose dependencies are all satisfied. UNVERIFIED does not satisfy a dependency:
// letting downstream work build on an unverified result is an arbitration decision, not a default.
export function readyTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => t.status === TaskStatus.PENDING
    && t.dependencies.every((d) => byId.get(d) && SATISFIED.has(byId.get(d).status)));
}

// Honest final state from task states (spec §55). Returns null while work remains.
export function missionOutcome(tasks) {
  const live = tasks.filter((t) => t.status !== TaskStatus.SUPERSEDED && t.status !== TaskStatus.CANCELLED);
  if (live.length === 0) return MissionStatus.UNKNOWN;
  const has = (s) => live.some((t) => t.status === s);
  if (has(TaskStatus.FAILED)) return MissionStatus.FAILED;
  if (has(TaskStatus.WAITING_FOR_USER)) return MissionStatus.WAITING_FOR_USER;
  if (has(TaskStatus.BLOCKED)) return MissionStatus.BLOCKED;
  if (has(TaskStatus.PENDING) || has(TaskStatus.READY) || has(TaskStatus.RUNNING) || has(TaskStatus.SUCCEEDED)) return null;
  const verified = live.filter((t) => t.status === TaskStatus.VERIFIED).length;
  if (verified === live.length) return MissionStatus.COMPLETED_VERIFIED;
  if (verified === 0) return MissionStatus.COMPLETED_UNVERIFIED;
  return MissionStatus.COMPLETED_PARTIALLY_VERIFIED;
}