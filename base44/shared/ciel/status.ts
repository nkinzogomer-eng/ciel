// Component status registry (amendment 11). This is the honest map of what exists.
// Updated at the end of every phase. Never mark a stub as IMPLEMENTED.
import { ComponentStatus as S } from './core/types.ts';

export const PHASE = 'H';

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
  { component: 'MemoryStore: Base44 entities (real persistence, restart-verified)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'B' },
  { component: 'MemoryStore: SQLite + migrations', layer: 'adapter', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'B (schema) / external (runtime)' },
  { component: 'IntelligenceProvider: null (AI disabled)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'IntelligenceProvider: mock (scripted, tests)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'A' },
  { component: 'IntelligenceProvider: JSON-constrained LLM (platform model)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'H' },
  { component: 'IntelligenceProvider: Anthropic / OpenAI keys (same adapter, injected call)', layer: 'adapter', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: 'H (adapter ready)' },
  // --- Core engines (Phases B–G) ---
  { component: 'Mission Ledger service', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'B' },
  { component: 'Checkpoint / Recovery engine', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'B/E' },
  { component: 'Goal Kernel (rule-based intake, no AI)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'C' },
  { component: 'Plan synthesis: prose → validated plan (AI proposes, Ciel validates)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'H' },
  { component: 'Mission Compiler', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'C' },
  { component: 'Mission Graph executor (deterministic)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'C' },
  { component: 'Capability Registry', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'C' },
  { component: 'Arbitration', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'D' },
  { component: 'Verification Engine (predicate / independent / consistency / human)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'D' },
  { component: 'Strategy selection (contextual, sunk-cost-independent)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'D' },
  { component: 'State Invalidation engine (fingerprint cascade)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'E' },
  { component: 'Budget Manager / Policy Plane', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'F' },
  { component: 'Loop / repetition detection', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'F' },
  { component: 'Experience Learning / Calibration / Self Model', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'G' },
  { component: 'Meta-reasoning (fallback first, then AI proposal ranked by arbitration)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'H' },
  { component: 'Cognitive Sufficiency (act / gather / ask / refuse)', layer: 'core', status: S.TESTED_IN_BASE44, phase: 'H' },
  // --- Capabilities ---
  { component: 'Deterministic capabilities (compute, transform, kv, notify, probes)', layer: 'capability', status: S.TESTED_IN_BASE44, phase: 'C' },
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