// Recovery engine (spec §29, amendment 4.1, fundamental test #10) — Phase B/E.
//
// The three guarantees, enforced here and nowhere else:
//   1. An idempotent in-flight action may be replayed.
//   2. A non-idempotent in-flight action is NEVER replayed before probing its effect.
//   3. When no probe is available, Ciel says UNKNOWN and asks the user. It never guesses.
import { recoveryPlan, RecoveryAction } from '../domain/checkpoint.ts';
import { LedgerEventType, TaskStatus } from '../core/types.ts';

export const RecoveryNext = Object.freeze({
  REPLAY: 'REPLAY',                     // safe to run again
  MARK_SUCCEEDED: 'MARK_SUCCEEDED',     // effect already happened, do not repeat it
  ASK_USER: 'ASK_USER',                 // effect unknown and unknowable without a human
});

export function createRecoveryEngine({ store, clock, ledger, registry }) {
  return {
    async recover(mission_id, { world = null } = {}) {
      const checkpoint = await store.latestCheckpoint(mission_id);
      const chain = await ledger.verify(mission_id);
      if (!checkpoint) {
        return { recovered: false, reason: 'no checkpoint persisted', chain, checkpoint: null, mission: null, tasks: [], actions: [] };
      }

      const actions = [];
      for (const step of recoveryPlan(checkpoint)) {
        const inflight = checkpoint.in_flight_actions.find((a) => a.task_id === step.task_id && a.capability === step.capability);
        if (step.action === RecoveryAction.REPLAY) {
          actions.push({ ...step, effect_occurred: null, next: RecoveryNext.REPLAY, reason: 'idempotent capability: replay is safe' });
          continue;
        }
        const cap = registry.get(step.capability);
        if (!cap || typeof cap.probeEffect !== 'function') {
          actions.push({ ...step, effect_occurred: 'UNKNOWN', next: RecoveryNext.ASK_USER, reason: 'non-idempotent action with no effect probe: replaying could duplicate the effect' });
          continue;
        }
        const probe = await cap.probeEffect(inflight.params || {}, { clock, mission_id, task_id: step.task_id, world });
        const occurred = probe && probe.occurred === true;
        await ledger.append(mission_id, LedgerEventType.action_effect_probed, {
          capability: step.capability, occurred, evidence: probe?.evidence ?? null,
        }, { task_id: step.task_id });
        actions.push({
          ...step, effect_occurred: occurred, evidence: probe?.evidence ?? null,
          next: occurred ? RecoveryNext.MARK_SUCCEEDED : RecoveryNext.REPLAY,
          reason: occurred ? 'effect verified present: the action must not run twice' : 'effect verified absent: replay is safe',
        });
      }

      // Tasks left RUNNING at crash time go back to READY only when a replay is authorized.
      const tasks = checkpoint.tasks.map((t) => {
        const decided = actions.find((a) => a.task_id === t.id);
        if (!decided || t.status !== TaskStatus.RUNNING) return t;
        if (decided.next === RecoveryNext.REPLAY) return { ...t, status: TaskStatus.READY };
        if (decided.next === RecoveryNext.MARK_SUCCEEDED) return { ...t, status: TaskStatus.SUCCEEDED };
        return { ...t, status: TaskStatus.WAITING_FOR_USER };
      });

      await ledger.append(mission_id, LedgerEventType.checkpoint_restored, {
        checkpoint_id: checkpoint.id, ledger_sequence: checkpoint.ledger_sequence,
        chain_ok: chain.ok, decisions: actions.map((a) => ({ task_id: a.task_id, next: a.next })),
      });

      return { recovered: true, reason: null, chain, checkpoint, mission: checkpoint.mission, tasks, actions };
    },
  };
}