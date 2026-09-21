// Checkpoint service (spec §29) — Phase B.
// A checkpoint is written BEFORE a risky action runs, carrying the in-flight action
// description. That is what makes crash recovery possible without guessing.
import { createCheckpoint } from '../domain/checkpoint.ts';
import { LedgerEventType } from '../core/types.ts';

export function createCheckpointService({ store, clock, newId, ledger }) {
  return {
    async save({ mission, tasks, in_flight_actions = [], state_fingerprints = {}, knowledge_ids = [], decision_ids = [] }) {
      const ledger_sequence = await ledger.lastSequence(mission.id);
      const cp = createCheckpoint({
        id: newId('cp'), mission_id: mission.id, ledger_sequence, mission, tasks,
        knowledge_ids, decision_ids, state_fingerprints, in_flight_actions, now: clock.now(),
      });
      await store.put('checkpoints', cp);
      await ledger.append(mission.id, LedgerEventType.checkpoint_created, {
        checkpoint_id: cp.id, ledger_sequence, in_flight: in_flight_actions.map((a) => a.capability),
      });
      return cp;
    },
    async latest(mission_id) {
      return store.latestCheckpoint(mission_id);
    },
    async all(mission_id) {
      const cps = await store.find('checkpoints', { mission_id });
      return cps.sort((a, b) => a.ledger_sequence - b.ledger_sequence);
    },
  };
}