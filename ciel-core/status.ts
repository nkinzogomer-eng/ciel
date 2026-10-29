// Component status registry (amendment 11). This is the honest map of what exists.
// Updated at the end of every phase. Never mark a stub as IMPLEMENTED.
//
// Rules for this file, learned the hard way:
//   - a component is listed here only if the file it names EXISTS;
//   - TESTED means the portable suite (ciel-core/tests) actually exercises it;
//   - TESTED_IN_BASE44 means it was verified against the platform specifically;
//   - "contrat défini" is not a status: a contract with no implementation is NOT_IMPLEMENTED.
import { ComponentStatus as S } from './core/types.ts';

export const PHASE = 'I';

export const COMPONENT_STATUS = Object.freeze([
  // --- Core vocabulary & primitives ---
  { component: 'Core vocabulary (states, transitions, enums)', layer: 'core', status: S.TESTED, phase: 'A' },
  { component: 'Clock injection', layer: 'core', status: S.TESTED, phase: 'A' },
  { component: 'Fingerprint (SHA-256 canonical)', layer: 'core', status: S.TESTED, phase: 'A' },
  { component: 'Config (AI off by default, single_provider, degradation)', layer: 'core', status: S.TESTED, phase: 'A' },
  // --- Domain models ---
  { component: 'Mission / Task models + transitions + WAITING_FOR_USER', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Structured Mission Plan (validate, topo-order, instantiate)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Knowledge model (epistemic levels, promotion rules, conflict)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Evidence / Observation / Integrity', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Decision Primitive (7 types, 4 confidences)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Strategy (contextual performance, sunk-cost-independent abandon)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Action Dependency Graph + replay policy', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Ledger events (hash chain)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Checkpoint + recovery plan (probe-before-replay)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Verification records + resolution rule', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Budget model (time/tokens/money/tool_calls/ai_calls)', layer: 'domain', status: S.TESTED, phase: 'A' },
  { component: 'Budget: CPU / RAM tracking', layer: 'domain', status: S.REQUIRES_EXTERNAL_RUNTIME, phase: '-' },
  { component: 'Experience + Prediction + contextual calibration', layer: 'domain', status: S.TESTED, phase: 'A' },
  // --- Interfaces ---
  { component: 'Capability interface + manifest (idempotent/reversible/side_effects)', layer: 'interface', status: S.TESTED, phase: 'A' },
  { component: 'MemoryStore interface', layer: 'interface', status: S.TESTED, phase: 'A' },
  { component: 'IntelligenceProvider interface + AI output contract + CognitiveContext', layer: 'interface', status: S.TESTED, phase: 'A' },
  // --- Adapters ---
  { component: 'MemoryStore: in-memory (reference / tests)', layer: 'adapter', status: S.TESTED, phase: 'A' },
  { component: 'MemoryStore: filesystem (durable, no database, no platform)', layer: 'adapter', status: S.TESTED, phase: 'I' },
  { component: 'MemoryStore: Base44 entities (real persistence, restart-verified)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'B' },
  { component: 'MemoryStore: SQLite', layer: 'adapter', status: S.NOT_IMPLEMENTED, phase: '-' },
  { component: 'IntelligenceProvider: null (AI disabled)', layer: 'adapter', status: S.TESTED, phase: 'A' },
  { component: 'IntelligenceProvider: mock (scripted, tests)', layer: 'adapter', status: S.TESTED, phase: 'A' },
  { component: 'IntelligenceProvider: JSON-constrained LLM (platform model)', layer: 'adapter', status: S.TESTED_IN_BASE44, phase: 'H' },
  { component: 'IntelligenceProvider: Anthropic / OpenAI client (createLlmProvider + your invokeLLM)', layer: 'adapter', status: S.NOT_IMPLEMENTED, phase: '-' },
  // --- Core engines (Phases B–G) ---
  { component: 'Mission Ledger service', layer: 'core', status: S.TESTED, phase: 'B' },
  { component: 'Checkpoint / Recovery engine', layer: 'core', status: S.TESTED, phase: 'B/E' },
  { component: 'Goal Kernel (rule-based intake, no AI)', layer: 'core', status: S.TESTED, phase: 'C' },
  { component: 'Plan synthesis: prose → validated plan (AI proposes, Ciel validates)', layer: 'core', status: S.TESTED, phase: 'H' },
  { component: 'Mission Compiler', layer: 'core', status: S.TESTED, phase: 'C' },
  { component: 'Mission Graph executor (deterministic)', layer: 'core', status: S.TESTED, phase: 'C' },
  { component: 'Capability Registry', layer: 'core', status: S.TESTED, phase: 'C' },
  { component: 'Arbitration', layer: 'core', status: S.TESTED, phase: 'D' },
  { component: 'Verification Engine (predicate / independent / consistency / human)', layer: 'core', status: S.TESTED, phase: 'D' },
  { component: 'Strategy selection (contextual, sunk-cost-independent)', layer: 'core', status: S.TESTED, phase: 'D' },
  { component: 'State Invalidation engine (fingerprint cascade)', layer: 'core', status: S.TESTED, phase: 'E' },
  { component: 'Budget Manager / Policy Plane', layer: 'core', status: S.TESTED, phase: 'F' },
  { component: 'Loop / repetition detection (scoped per mission)', layer: 'core', status: S.TESTED, phase: 'F/I' },
  { component: 'Experience Learning / Calibration / Self Model', layer: 'core', status: S.TESTED, phase: 'G' },
  { component: 'Meta-reasoning (deterministic fallback first, then AI ranked by arbitration)', layer: 'core', status: S.TESTED, phase: 'H' },
  { component: 'Cognitive Sufficiency (act / gather / ask / refuse)', layer: 'core', status: S.TESTED, phase: 'H' },
  // --- Orchestration (Phase I) ---
  { component: 'Orchestrator: intention → mission → verification → ledger', layer: 'core', status: S.TESTED, phase: 'I' },
  { component: 'Persisted plan proposal + human confirmation (fingerprint-checked)', layer: 'core', status: S.TESTED, phase: 'I' },
  { component: 'Automatic reframe replay of a declared fallback', layer: 'core', status: S.NOT_IMPLEMENTED, phase: '-' },
  // --- Capabilities ---
  { component: 'Deterministic capabilities (compute, transform, kv, notify, probes)', layer: 'capability', status: S.TESTED, phase: 'C' },
  { component: 'Shell adapter (shell.exec)', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: '-' },
  { component: 'Filesystem adapter (fs.read / fs.write)', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: '-' },
  { component: 'Git adapter', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: '-' },
  { component: 'MCP adapter', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: '-' },
  { component: 'Hermes / OpenClaw adapters', layer: 'capability', status: S.NOT_IMPLEMENTED, phase: '-' },
  // --- Surfaces ---
  { component: 'Base44 console (status + test dashboard + checks)', layer: 'surface', status: S.IMPLEMENTED, phase: 'A/H' },
  { component: 'Standalone CLI (ciel-core/bin/ciel.mjs)', layer: 'surface', status: S.IMPLEMENTED, phase: 'I' },
  { component: 'Standalone HTTP API (ciel-core/server, Bun/Deno/Node)', layer: 'surface', status: S.IMPLEMENTED, phase: 'I' },
  { component: 'Telegram adapter', layer: 'surface', status: S.NOT_IMPLEMENTED, phase: '-' },
]);

export function statusSummary() {
  const counts = {};
  for (const c of COMPONENT_STATUS) counts[c.status] = (counts[c.status] || 0) + 1;
  return { phase: PHASE, total: COMPONENT_STATUS.length, counts };
}

// Claims this registry explicitly refuses to make. Used by the console and the README so the
// absence of a feature is always stated somewhere, not merely implied by its absence.
export const NOT_CLAIMED = Object.freeze([
  'A tamper-PROOF ledger: the hash chain is tamper-EVIDENT and needs an external anchor to be more.',
  'Multi-tenant isolation: the store is not partitioned by user; that is the caller\'s job.',
  'A conversational surface: Ciel classifies conversation and says it has no answer surface.',
  'Automatic replay of a declared fallback after a failure (reported, not executed).',
  'CPU/RAM accounting in the budget.',
  'Any capability that touches the real system (shell, filesystem, git, network, mail).',
]);
