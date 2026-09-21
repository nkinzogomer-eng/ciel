// Ciel Core — shared vocabulary.
// Pure constants and small assertion helpers. No runtime, platform or AI dependency.
// Portable to any JavaScript runtime (Deno, Node, Bun, browser).

const freeze = (o) => Object.freeze(o);
const enumOf = (...names) => freeze(Object.fromEntries(names.map((n) => [n, n])));

export class CielError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CielError';
    this.code = code;
    this.details = details;
  }
}

// ---- Intake -------------------------------------------------------------
export const IntakeKind = enumOf('CONVERSATION', 'QUESTION', 'ADVICE', 'MISSION');

// ---- Mission ------------------------------------------------------------
export const MissionStatus = enumOf(
  'CREATED', 'COMPILED', 'RUNNING', 'WAITING_FOR_USER', 'BLOCKED',
  'COMPLETED_VERIFIED', 'COMPLETED_PARTIALLY_VERIFIED', 'COMPLETED_UNVERIFIED',
  'FAILED', 'UNKNOWN', 'CANCELLED',
);

export const MISSION_TERMINAL = freeze(new Set([
  MissionStatus.COMPLETED_VERIFIED, MissionStatus.COMPLETED_PARTIALLY_VERIFIED,
  MissionStatus.COMPLETED_UNVERIFIED, MissionStatus.FAILED, MissionStatus.UNKNOWN, MissionStatus.CANCELLED,
]));

// WAITING_FOR_USER: progress is possible with human information.
// BLOCKED: no progress is possible with currently available capabilities.
export const MISSION_TRANSITIONS = freeze({
  CREATED: ['COMPILED', 'FAILED', 'CANCELLED'],
  COMPILED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING_FOR_USER', 'BLOCKED', 'COMPLETED_VERIFIED', 'COMPLETED_PARTIALLY_VERIFIED',
    'COMPLETED_UNVERIFIED', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  WAITING_FOR_USER: ['RUNNING', 'CANCELLED'],
  BLOCKED: ['RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED_VERIFIED: [], COMPLETED_PARTIALLY_VERIFIED: [], COMPLETED_UNVERIFIED: [],
  FAILED: [], UNKNOWN: [], CANCELLED: [],
});

// ---- Task ---------------------------------------------------------------
export const TaskStatus = enumOf(
  'PENDING', 'READY', 'RUNNING', 'BLOCKED', 'WAITING_FOR_USER', 'FAILED',
  'SUCCEEDED', 'VERIFIED', 'UNVERIFIED', 'CANCELLED', 'SUPERSEDED',
);

export const TASK_TRANSITIONS = freeze({
  PENDING: ['READY', 'CANCELLED', 'SUPERSEDED'],
  READY: ['RUNNING', 'BLOCKED', 'WAITING_FOR_USER', 'CANCELLED', 'SUPERSEDED'],
  // RUNNING -> READY only happens through Recovery (interrupted action, effect verified absent).
  RUNNING: ['SUCCEEDED', 'FAILED', 'BLOCKED', 'WAITING_FOR_USER', 'READY', 'CANCELLED'],
  SUCCEEDED: ['VERIFIED', 'UNVERIFIED', 'SUPERSEDED'],
  FAILED: ['READY', 'CANCELLED', 'SUPERSEDED'],
  BLOCKED: ['READY', 'CANCELLED', 'SUPERSEDED'],
  WAITING_FOR_USER: ['READY', 'CANCELLED', 'SUPERSEDED'],
  VERIFIED: ['SUPERSEDED'],
  UNVERIFIED: ['VERIFIED', 'SUPERSEDED'],
  CANCELLED: [], SUPERSEDED: [],
});

// ---- Knowledge ----------------------------------------------------------
export const EpistemicLevel = freeze({
  UNKNOWN: 0, HYPOTHESIS: 1, INFERENCE: 2, CORROBORATED_INFERENCE: 3, OBSERVED_FACT: 4, VERIFIED_FACT: 5,
});
export const EpistemicLevelName = freeze(Object.fromEntries(Object.entries(EpistemicLevel).map(([k, v]) => [v, k])));
export const KnowledgeKind = enumOf('UNKNOWN', 'HYPOTHESIS', 'INFERENCE', 'FACT');
export const Validity = enumOf('VALID', 'STALE', 'INVALIDATED');
export const EvidenceKind = enumOf('CLAIM', 'OBSERVATION', 'VERIFICATION');
export const IntegrityStatus = enumOf('UNASSESSED', 'TRUSTED', 'SUSPECT');
export const ConflictState = enumOf('CONSISTENT', 'CONFLICTED', 'RESOLVED', 'INSUFFICIENT_EVIDENCE');

// ---- Verification -------------------------------------------------------
export const VerificationState = enumOf('VERIFIED', 'UNVERIFIED', 'PARTIALLY_VERIFIED', 'CONTRADICTED', 'UNKNOWN');
export const VerifierKind = enumOf('PREDICATE', 'INDEPENDENT_OBSERVATION', 'CONSISTENCY', 'HUMAN_ATTESTATION');

// ---- Decision -----------------------------------------------------------
export const DecisionType = enumOf('BOOLEAN', 'CHOICE', 'SCORE', 'RANK', 'ESTIMATE', 'CLASSIFICATION', 'PROBABILITY');
export const DecisionValidity = enumOf('VALID', 'INVALID', 'UNCERTAIN', 'SUPERSEDED');

// ---- Intelligence / degradation ----------------------------------------
export const Sufficiency = enumOf('SUFFICIENT', 'INSUFFICIENT', 'UNCERTAIN');
export const DegradationLevel = enumOf('FULL', 'REDUCED', 'CORE_ONLY');

// ---- Budget -------------------------------------------------------------
export const BudgetDecision = enumOf(
  'CONTINUE', 'REDUCE_SCOPE', 'CHANGE_STRATEGY', 'REQUEST_AUTHORIZATION', 'PARTIAL_RESULT', 'BLOCKED', 'STOP',
);

// ---- Capabilities / portability ----------------------------------------
export const RuntimeRequirement = enumOf('ANY', 'BASE44', 'EXTERNAL');
export const ComponentStatus = enumOf(
  'IMPLEMENTED', 'TESTED_IN_BASE44', 'SIMULATED', 'STUB', 'NOT_IMPLEMENTED', 'REQUIRES_EXTERNAL_RUNTIME',
);

// ---- Ledger -------------------------------------------------------------
export const LedgerEventType = enumOf(
  'mission_created', 'mission_compiled', 'task_started', 'action_started', 'action_effect_probed',
  'tool_called', 'observation_received', 'decision_created', 'decision_invalidated',
  'strategy_selected', 'strategy_changed', 'state_invalidated', 'checkpoint_created',
  'checkpoint_restored', 'verification_completed', 'loop_detected', 'budget_assessed',
  'user_question_asked', 'user_answer_received', 'mission_blocked', 'mission_waiting_for_user',
  'mission_completed', 'mission_failed', 'diagnostic_recorded', 'experience_recorded',
);

// ---- Helpers ------------------------------------------------------------
export function assertOneOf(enumObj, value, label) {
  if (!Object.prototype.hasOwnProperty.call(enumObj, value)) {
    throw new CielError('INVALID_ENUM', `${label}: "${value}" is not one of ${Object.keys(enumObj).join(', ')}`);
  }
  return value;
}

export function assertTransition(table, from, to, label) {
  const allowed = table[from];
  if (!allowed) throw new CielError('INVALID_STATE', `${label}: unknown state "${from}"`);
  if (!allowed.includes(to)) {
    throw new CielError('ILLEGAL_TRANSITION', `${label}: ${from} -> ${to} is not allowed`, { from, to, allowed });
  }
  return to;
}

export function assertUnitInterval(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new CielError('OUT_OF_RANGE', `${label} must be a number in [0, 1], got ${value}`);
  }
  return value;
}