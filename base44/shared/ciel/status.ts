// Component status registry (amendment 11). This is the honest map of what exists.
// Updated at the end of every phase. Never mark a stub as IMPLEMENTED.
import { ComponentStatus as S } from './core/types.ts';

export const PHASE = 'A';

export const COMPONENT_STATUS = Object.freeze([
  // --- Core vocabulary & primitives ---
  { component: 'Core vocabulary (states, transitions, enums)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Clock injection', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Fingerprint (SHA-256 canonical)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Config (AI off by default, single_provider, degradation)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'A' },
  // --- Domain models ---
  { component: 'Mission / Task models + transitions + WAITING_FOR_USER', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Structured Mission Plan (validate, topo-order, instantiate)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Knowledge model (epistemic levels, promotion rules, conflict)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Evidence / Observation / Integrity', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Decision Primitive (7 types, 4 confidences)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Strategy (contextual performance, sunk-cost-independent abandon)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Action Dependency Graph + replay policy', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Ledger events (hash chain)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Checkpoint + recovery plan (probe-before-replay)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Verification records + resolution rule', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Budget model (time/tokens/money/tool_calls/ai_calls)', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'Budget: CPU / RAM tracking', layer: 'domain', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: '-' },
  { component: 'Experience + Prediction + contextual calibration', layer: 'domain', status: S.TESTED_IN_BASE44, phase: 'A' },
  // --- Interfaces ---
  { component: 'Capability interface + manifest (idempotent/reversible/side_effects)', layer: 'interface', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'MemoryStore interface', layer: 'interface', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'IntelligenceProvider interface + AI output contract + CognitiveContext', layer: 'interface', status: S.TESTED_IN_BASE44, phase: 'A' },
  // --- Adapters ---
  { component: 'MemoryStore: in-memory (reference / tests)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'MemoryStore: Base44 entities (prototype persistence)', layer: 'adapter', status: S.NOT_IMPLEMENTED, phase: 'B' },
  { component: 'MemoryStore: SQLite + migrations', layer: 'adapter', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'B (schema) / external (runtime)' },
  { component: 'IntelligenceProvider: null (AI disabled)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'IntelligenceProvider: mock (scripted, tests)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'IntelligenceProvider: Anthropic / Claude', layer: 'adapter', status: S.NOT_IMPLEMENTED, phase: 'Milestone 2' },
  // --- Core engines (Phases B–G) ---
  { component: 'Mission Ledger service', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'B' },
  { component: 'Checkpoint / Recovery engine', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'B/E' },
  { component: 'Goal Kernel (rule-based intake, no AI)', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'C' },
  { component: 'Mission Compiler', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'C' },
  { component: 'Mission Graph executor (deterministic)', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'C' },
  { component: 'Capability Registry', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'C' },
  { component: 'Arbitration', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'D' },
  { component: 'Verification Engine (4 verifiers)', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'D' },
  { component: 'State Invalidation engine (fingerprint cascade)', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'E' },
  { component: 'Budget Manager / Policy Plane / Loop Detection', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'F' },
  { component: 'Experience Learning / Calibration / Self Model / Diagnostics', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'G' },
  { component: 'Reasoning / Strategy / Meta-reasoning engines', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'D/G' },
  { component: 'Cognitive Sufficiency', layer: 'core', status: S.NOT_IMPLEMENTED, phase: 'Milestone 2' },
  // --- Capabilities ---
  { component: 'Deterministic capabilities (compute, transform, http_fetch, ciel_state)', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: 'C' },
  { component: 'Shell / Filesystem / Git / MCP adapters', layer: 'capability', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'C (interface+mock)' },
  { component: 'Hermes / OpenClaw adapters', layer: 'capability', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'later (interface+mock)' },
  // --- Interfaces (surfaces) ---
  { component: 'Base44 console (status + test dashboard)', layer: 'surface', status: S.IMPLEMENTED, phase: 'A (minimal) / H' },
  { component: 'Telegram adapter', layer: 'surface', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'later' },
  { component: 'CLI', layer: 'surface', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'later' },
]);

export function statusSummary() {
  const counts = {};
  for (const c of COMPONENT_STATUS) counts[c.status] = (counts[c.status] || 0) + 1;
  return { phase: PHASE, total: COMPONENT_STATUS.length, counts };
}