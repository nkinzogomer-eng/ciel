// Ciel Orchestrator — the missing end-to-end path: intention -> verified mission -> ledger.
//
// Before this file, every engine worked but nothing called them in the right order outside
// the tests: goalKernel and sufficiency were only reachable from a test file, and nothing
// turned a human intention into an executed mission. This is that assembly, and nothing else:
// it contains no new reasoning, it only enforces the order and the gates.
//
// Order (each step is a refusal point, never a guess):
//   intake        goalKernel.classify (no AI)            -> conversation | question | advice | mission
//   plan          structured plan, or AI proposal        -> validated by Ciel, never trusted
//   confirmation  an AI-written plan needs a human yes   -> plan fingerprint, not a boolean alone
//   sufficiency   assessSufficiency                      -> REFUSE blocks irreversible + unverifiable
//   compile       missionCompiler                        -> unknown capability = refusal
//   execute       executor                               -> verification decides the outcome
//   reframe       metaReasoning (only on FAILED)         -> recorded, never auto-applied
//   report        ledger.verify                          -> the chain is checked before reporting
//
// The result of `handle()` is a *report of what happened*, not a promise of success. A mission
// that ends BLOCKED, UNVERIFIED or FAILED is reported as such, with the reason.
import { IntakeKind, LedgerEventType, MissionStatus, TaskStatus, VerificationState, EpistemicLevel } from './core/types.ts';
import { classifyIntake } from './engines/goalKernel.ts';
import { assessSufficiency, Sufficiency } from './engines/sufficiency.ts';
import { SynthesisOutcome } from './engines/planSynthesis.ts';
import { RiskClass, riskClass } from './domain/actionGraph.ts';
import { validatePlan } from './domain/plan.ts';
import { fingerprint } from './core/fingerprint.ts';

// What came out of `handle()`. Distinct from MissionStatus on purpose: a mission can be
// COMPLETED_VERIFIED while the *request* was only ACCEPTED (waiting for a confirmation).
export const RunStatus = Object.freeze({
  EXECUTED: 'EXECUTED',                       // a mission was compiled and run; read `mission.status`
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION', // an AI plan is ready, nothing was executed
  NOT_EXECUTABLE: 'NOT_EXECUTABLE',           // conversation / question / advice: no mission
  REJECTED: 'REJECTED',                       // the plan (or the proposal) failed Ciel's gates
  REFUSED: 'REFUSED',                         // sufficiency says acting would be irresponsible
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',           // prose needed a model and none answered
});

const RISK_ORDER = { PURE: 0, REVERSIBLE: 1, IRREVERSIBLE: 2 };

function describeFailure(report, mission) {
  const failed = (report.tasks || []).find((t) => t.status === TaskStatus.FAILED);
  if (failed) {
    const last = failed.status_history[failed.status_history.length - 1];
    return { task: failed, reason: last?.reason || 'task failed' };
  }
  const blocked = (report.tasks || []).find((t) => t.status === TaskStatus.BLOCKED);
  if (blocked) {
    const last = blocked.status_history[blocked.status_history.length - 1];
    return { task: blocked, reason: last?.reason || 'task blocked' };
  }
  const last = mission.status_history[mission.status_history.length - 1];
  return { task: null, reason: last?.reason || `mission ended ${mission.status}` };
}

function emptyReport() {
  return {
    intake: null, plan: null, ai_authored: false, requires_confirmation: false, confirmation: null,
    provenance: null, sufficiency: null, mission: null, tasks: [], steps: [], outcome: null,
    verification: null, ledger: null, reframe: null, ai_calls: 0, errors: [],
  };
}

export function createOrchestrator({
  store, clock, newId, ledger, registry, config,
  compiler, executor, recovery, synthesizer, meta = null, provider = null,
}) {
  // Sufficiency is assessed on the PLAN, not on prose: it needs claims, and the only claims
  // Ciel has at this point are the tasks the plan declares.
  function sufficiencyOf(plan) {
    const claims = plan.tasks.map((t) => ({
      id: t.id,
      claim: `${t.action.capability} produces the expected result`,
      critical: true,
      level: t.verification ? EpistemicLevel.INFERENCE : EpistemicLevel.UNKNOWN,
    }));
    const unverifiable = plan.tasks.filter((t) => !t.verification || !t.verification.kind);
    let maxRisk = RiskClass.PURE;
    for (const t of plan.tasks) {
      const manifest = registry.manifest(t.action.capability);
      const r = manifest ? riskClass(manifest) : RiskClass.IRREVERSIBLE;
      if (RISK_ORDER[r] > RISK_ORDER[maxRisk]) maxRisk = r;
    }
    return assessSufficiency({
      goal: plan.goal,
      claims,
      unknowns: unverifiable.map((t) => ({ question: `task ${t.id} declares no verifier`, blocking: false })),
      risk_class: maxRisk,
      verification_available: unverifiable.length === 0,
    });
  }

  function summarizeTasks(tasks) {
    const counts = { verified: 0, unverified: 0, failed: 0, blocked: 0, pending: 0, waiting: 0 };
    for (const t of tasks) {
      if (t.status === TaskStatus.VERIFIED) counts.verified += 1;
      else if (t.status === TaskStatus.UNVERIFIED) counts.unverified += 1;
      else if (t.status === TaskStatus.FAILED) counts.failed += 1;
      else if (t.status === TaskStatus.BLOCKED) counts.blocked += 1;
      else if (t.status === TaskStatus.WAITING_FOR_USER) counts.waiting += 1;
      else counts.pending += 1;
    }
    return counts;
  }

  async function handle(input, {
    confirm = null, limits = null, deadline = null, world = null, observe = null,
    humanAnswers = {}, confirmations = {}, maxSteps = 50,
  } = {}) {
    // ---------------------------------------------------------------- 0. confirmation
    // Confirming replays a PROPOSAL THAT WAS PERSISTED, never a fresh model call: re-asking the
    // model for the same prose produces a different plan and a different fingerprint, which would
    // make a human's approval impossible to honour.
    let approvedProposal = null;
    if (confirm !== null && confirm !== undefined && confirm !== false) {
      if (typeof confirm !== 'string') {
        return {
          ...emptyReport(), status: RunStatus.REJECTED,
          reason: 'confirmation must be a proposal id returned by a previous AWAITING_CONFIRMATION',
        };
      }
      approvedProposal = await store.get('proposals', confirm);
      if (!approvedProposal) {
        return {
          ...emptyReport(), status: RunStatus.REJECTED,
          reason: `no pending proposal with id "${confirm}"; nothing was executed`,
        };
      }
      if (approvedProposal.status === 'accepted') {
        return {
          ...emptyReport(), status: RunStatus.REJECTED,
          reason: `proposal "${confirm}" was already accepted for mission ${approvedProposal.mission_id}`,
        };
      }
    }

    // ---------------------------------------------------------------- 1. intake
    const intake = approvedProposal ? null : classifyIntake(input);
    const base = {
      intake, status: null, plan: null, ai_authored: false, requires_confirmation: false,
      confirmation: null, provenance: null, sufficiency: null, mission: null, tasks: [],
      steps: [], outcome: null, verification: null, ledger: null, reframe: null,
      ai_calls: provider && typeof provider.callCount === 'function' ? provider.callCount() : 0,
      errors: [],
    };

    // A plan-shaped input that fails validation is a rejection with reasons, not an
    // unclassifiable request: the caller asked for a mission and the mission is broken.
    const isStructuredPlan = input !== null && typeof input === 'object' && Array.isArray(input.tasks);
    if (isStructuredPlan && !approvedProposal && !intake.executable) {
      return {
        ...base, status: RunStatus.REJECTED,
        reason: intake.reason,
        errors: validatePlan(input).errors,
      };
    }

    if (!approvedProposal && intake.kind !== IntakeKind.MISSION) {
      return {
        ...base, status: RunStatus.NOT_EXECUTABLE,
        reason: intake.reason,
        // A conversation or a question is not a failure: Ciel says plainly that it has no
        // conversational surface, instead of pretending to answer with a plan.
        requires: ['a structured mission plan (or an actionable instruction plus an intelligence provider)'],
      };
    }

    // ---------------------------------------------------------------- 2. plan
    let plan = null;
    let aiAuthored = false;
    let provenance = null;

    if (approvedProposal) {
      plan = approvedProposal.plan;
      aiAuthored = true;
      provenance = approvedProposal.provenance ?? null;
    } else if (intake.executable) {
      plan = intake.plan;
    } else {
      if (!config.ai.enabled || !synthesizer) {
        return {
          ...base, status: RunStatus.NOT_EXECUTABLE, reason: intake.reason,
          requires: ['a structured mission plan, or ai.enabled with a reachable provider'],
        };
      }
      const synthesis = await synthesizer.synthesize(String(input));
      if (synthesis.outcome === SynthesisOutcome.AI_UNAVAILABLE) {
        return { ...base, status: RunStatus.AI_UNAVAILABLE, reason: synthesis.reason, errors: synthesis.errors || [] };
      }
      if (synthesis.outcome === SynthesisOutcome.REJECTED) {
        return {
          ...base, status: RunStatus.REJECTED, ai_authored: true, provenance: synthesis.provenance ?? null,
          reason: synthesis.reason, errors: synthesis.errors || [],
        };
      }
      plan = synthesis.plan;
      aiAuthored = true;
      provenance = synthesis.provenance ?? null;
    }

    // ---------------------------------------------------------------- 3. Ciel's own gates
    const validation = validatePlan(plan);
    if (!validation.ok) {
      return {
        ...base, status: RunStatus.REJECTED, ai_authored: aiAuthored, provenance,
        reason: 'the plan failed validation', errors: validation.errors,
      };
    }
    const missing = registry.missing(plan.tasks.map((t) => t.action.capability));
    if (missing.length) {
      return {
        ...base, status: RunStatus.REJECTED, ai_authored: aiAuthored, provenance,
        reason: 'the plan requires capabilities Ciel does not have; it is refused, not improvised',
        errors: [`unknown capabilities: ${missing.join(', ')}`],
      };
    }

    const planFingerprint = await fingerprint(plan);
    const confirmation = { required: false, plan_fingerprint: planFingerprint };

    // ---------------------------------------------------------------- 4. confirmation
    if (aiAuthored) {
      confirmation.required = true;
      if (!approvedProposal) {
        const proposal = {
          id: newId('proposal'),
          status: 'pending',
          goal: String(input).slice(0, 500),
          plan,
          plan_fingerprint: planFingerprint,
          provenance,
          created_at: clock.now(),
        };
        await store.put('proposals', proposal);
        return {
          ...base, status: RunStatus.AWAITING_CONFIRMATION, plan, ai_authored: true,
          provenance, requires_confirmation: true,
          confirmation: {
            required: true, proposal_id: proposal.id, plan_fingerprint: planFingerprint,
            plan, provenance,
          },
          sufficiency: sufficiencyOf(plan),
          reason: 'a model wrote this plan; a human must approve exactly this plan before it runs',
        };
      }
      // The plan comes from storage: it is the exact object the human approved. If it was
      // altered in the store, its fingerprint no longer matches the one recorded.
      if (approvedProposal.plan_fingerprint !== planFingerprint) {
        return {
          ...base, status: RunStatus.REJECTED, ai_authored: true, provenance,
          reason: 'the stored proposal was modified after approval (fingerprint mismatch); nothing was executed',
          confirmation: { required: true, proposal_id: approvedProposal.id, plan_fingerprint: approvedProposal.plan_fingerprint },
        };
      }
      confirmation.approved = true;
      confirmation.proposal_id = approvedProposal.id;
    }

    // ---------------------------------------------------------------- 5. sufficiency
    const sufficiency = sufficiencyOf(plan);
    if (sufficiency.recommendation === Sufficiency.REFUSE) {
      return {
        ...base, status: RunStatus.REFUSED, plan, ai_authored: aiAuthored, provenance,
        sufficiency, requires_confirmation: aiAuthored, confirmation,
        reason: sufficiency.reason,
      };
    }

    // ---------------------------------------------------------------- 6. compile
    let compiled;
    try {
      compiled = await compiler.compile(plan, { limits, deadline, source: aiAuthored ? 'ai_plan' : 'structured_plan' });
    } catch (e) {
      return {
        ...base, status: RunStatus.REJECTED, plan, ai_authored: aiAuthored, provenance, sufficiency,
        reason: e.message, errors: Array.isArray(e.details) ? e.details : [e.code || 'COMPILE_FAILED'],
      };
    }

    if (approvedProposal) {
      await store.put('proposals', {
        ...approvedProposal, status: 'accepted', mission_id: compiled.mission.id, accepted_at: clock.now(),
      });
    }

    // ---------------------------------------------------------------- 7. execute
    const report = await executor.run(compiled.mission.id, {
      world, observe, humanAnswers, confirmations, maxSteps,
    });

    // ---------------------------------------------------------------- 8. reframe (FAILED only)
    let reframe = null;
    if (meta && report.outcome === MissionStatus.FAILED) {
      const failure = describeFailure(report, report.mission);
      try {
        reframe = await meta.reframe({
          mission_id: compiled.mission.id,
          task: failure.task,
          goal: report.mission.goal,
          failure: failure.reason,
          reframes_used: 0,
          evidence: [],
          failed_strategies: [],
        });
      } catch (e) {
        reframe = { source: null, reason: `meta-reasoning failed: ${e.message}`, requires_user: true };
      }
      await ledger.append(compiled.mission.id, LedgerEventType.diagnostic_recorded, {
        cause: 'meta_reframe',
        source: reframe.source,
        requires_user: reframe.requires_user ?? null,
        why: reframe.reason,
      });
      // A proposal from the model is stored as an UNCERTAIN decision; it is never executed here.
      if (reframe.decision) await store.put('decisions', reframe.decision);
    }

    // ---------------------------------------------------------------- 9. report
    const chain = await ledger.verify(compiled.mission.id);
    const summary = await ledger.summary(compiled.mission.id);
    const tasks = await store.find('tasks', { mission_id: compiled.mission.id });
    // Verification records are keyed by subject (task), not by mission.
    const taskIds = new Set(tasks.map((t) => t.id));
    const verifications = (await store.find('verifications', {})).filter((v) => taskIds.has(v.subject_id));

    return {
      ...base,
      status: RunStatus.EXECUTED,
      plan, sufficiency,
      ai_authored: aiAuthored,
      provenance,
      requires_confirmation: aiAuthored,
      confirmation,
      mission: report.mission,
      tasks,
      steps: report.steps,
      truncated: report.truncated,
      outcome: report.outcome,                                  // MissionStatus
      question: report.question ?? null,                        // set when WAITING_FOR_USER
      verification: {
        ...summarizeTasks(tasks),
        records: verifications.length,
        contradicted: verifications.filter((v) => v.state === VerificationState.CONTRADICTED).length,
      },
      ledger: { ...summary, chain_ok: chain.ok, chain_reason: chain.reason },
      reframe,
      budget: report.budget ? { used: report.budget.used, limits: report.budget.limits } : null,
      ai_calls: provider && typeof provider.callCount === 'function' ? provider.callCount() : 0,
      reason: null,
    };
  }

  // Recovery is not part of `handle()`: resuming an interrupted mission is a separate,
  // explicit decision (and the only place where an action may be replayed).
  async function resume(mission_id, { world = null, confirmations = {}, humanAnswers = {}, maxSteps = 50 } = {}) {
    if (!recovery) throw new Error('resume() requires the recovery engine');
    const plan = await recovery.recover(mission_id, { world });
    if (!plan.recovered) return { resumed: false, reason: plan.reason, recovery: plan };
    for (const t of plan.tasks) await store.put('tasks', t);
    if (plan.mission) await store.put('missions', plan.mission);
    const report = await executor.run(mission_id, { world, confirmations, humanAnswers, maxSteps });
    return { resumed: true, recovery: plan, report, outcome: report.outcome };
  }

  return { handle, resume, sufficiencyOf };
}
