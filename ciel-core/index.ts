// Ciel — public entry point of the portable core.
//
// Use this module from outside the repository:
//   import { createCiel, createInMemoryStore, createWorld } from 'ciel-core';
//
// Everything reachable from here runs with zero platform dependency: only the standard
// Web APIs (crypto.subtle, crypto.randomUUID, TextEncoder). No Node built-in, no Deno
// built-in, no Base44 SDK, no npm dependency.
export { CIEL_VERSION } from './core/version.ts';
export const CORE_LAYERS = Object.freeze(['core', 'domain', 'engines', 'interfaces', 'adapters', 'capabilities']);

// --- assembly ---------------------------------------------------------------
export { createCiel } from './runtime.ts';
export { createOrchestrator, RunStatus } from './orchestrator.ts';

// --- honesty registry -------------------------------------------------------
export { COMPONENT_STATUS, statusSummary, PHASE } from './status.ts';

// --- core primitives --------------------------------------------------------
export { SystemClock, fixedClock, assertClock } from './core/clock.ts';
export { newId, sequentialIds } from './core/ids.ts';
export { fingerprint, canonicalize, fingerprintMatches, deepEqual } from './core/fingerprint.ts';
export { createConfig, DEFAULT_CONFIG, degradationLevel } from './core/config.ts';
export { evaluatePredicate, describePredicate, getPath } from './core/predicate.ts';
export {
  CielError, IntakeKind, MissionStatus, TaskStatus, VerificationState, VerifierKind,
  ComponentStatus, RuntimeRequirement, EpistemicLevel, DegradationLevel, BudgetDecision, LedgerEventType,
} from './core/types.ts';

// --- domain -----------------------------------------------------------------
export { createMission, createTask, transitionMission, transitionTask, missionOutcome, readyTasks } from './domain/mission.ts';
export { validatePlan, instantiatePlan, topologicalOrder, PLAN_JSON_SCHEMA } from './domain/plan.ts';
export { createBudget, consume, assessBudget, utilization, operationAllowed, BUDGET_DIMENSIONS } from './domain/budget.ts';
export { createActionPlan, RiskClass, ReplayPolicy, riskClass, replayPolicy } from './domain/actionGraph.ts';
export { createEvent, sealEvent, verifyChain } from './domain/ledger.ts';
export { createCheckpoint, recoveryPlan, RecoveryAction } from './domain/checkpoint.ts';
export { createConfidence, overallConfidence, fromExternalClaim } from './domain/confidence.ts';
export { createDecision, validateDecision, invalidateDecision, supersedeDecision } from './domain/decision.ts';
export { createKnowledgeItem, createHypothesis, promote, markStale, invalidate, assessConflict, kindForLevel } from './domain/knowledge.ts';
export { createObservation, assessIntegrity, observationToEvidence } from './domain/evidence.ts';
export { createVerificationRecord, applicableVerifier, resolveVerificationState } from './domain/verification.ts';
export { createExperience, createPrediction, resolvePrediction, calibration } from './domain/experience.ts';

// --- engines ----------------------------------------------------------------
export { classifyIntake } from './engines/goalKernel.ts';
export { createPlanSynthesizer, SynthesisOutcome } from './engines/planSynthesis.ts';
export { createMissionCompiler } from './engines/missionCompiler.ts';
export { createExecutor } from './engines/executor.ts';
export { createCapabilityRegistry } from './engines/capabilityRegistry.ts';
export { createVerificationEngine } from './engines/verificationEngine.ts';
export { createLedgerService } from './engines/ledgerService.ts';
export { createCheckpointService } from './engines/checkpointService.ts';
export { createRecoveryEngine, RecoveryNext } from './engines/recoveryEngine.ts';
export { createLoopDetector, LoopKind } from './engines/loopDetector.ts';
export { createLearningEngine } from './engines/learning.ts';
export { createMetaReasoner, ReframeSource } from './engines/metaReasoning.ts';
export { arbitrate, ArbitrationOutcome, rank } from './engines/arbitration.ts';
export { selectStrategy, reconsider, assertSunkCostIgnored } from './engines/strategySelector.ts';
export { assessSufficiency, Sufficiency } from './engines/sufficiency.ts';
export { recordPreconditions, checkPreconditions, invalidationClosure, applyInvalidation } from './engines/invalidation.ts';

// --- interfaces -------------------------------------------------------------
export { createManifest, validateManifest, assertCapability } from './interfaces/capability.ts';
export { assertMemoryStore, COLLECTIONS, MEMORY_STORE_METHODS } from './interfaces/memoryStore.ts';
export {
  assertIntelligenceProvider, validateAiOutput, createCognitiveContext, AiUnavailableError, AI_OUTPUT_REQUIRED,
} from './interfaces/intelligenceProvider.ts';

// --- adapters (the only implementations shipped) ----------------------------
export { createInMemoryStore } from './adapters/memory/inMemoryStore.ts';
export { createNullProvider, createMockProvider } from './adapters/intelligence/nullProvider.ts';
export { createLlmProvider, aiOutputSchema } from './adapters/intelligence/base44Provider.ts';
// Note: adapters/base44/entityStore.ts is NOT exported here. It is the platform adapter, not
// part of the portable surface: whoever uses it passes their own entity accessor.

// --- capabilities -----------------------------------------------------------
export { createWorld } from './capabilities/world.ts';
export { registerReferenceCapabilities, dataTransform, kvGet, kvSet, counterIncrement, mailSend, alwaysFails } from './capabilities/reference.ts';

// --- test harness (exported so any surface can run the suites) --------------
export { runAll } from './tests/index.ts';
