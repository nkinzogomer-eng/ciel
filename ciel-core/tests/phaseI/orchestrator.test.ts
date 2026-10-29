// Phase I — the end-to-end path. These tests exist because the pipeline was the missing piece:
// every engine worked, but nothing called them in order outside a test file.
//
// The point of the suite is the same as the whole project: a request that cannot be honoured
// honestly must end in NOT_EXECUTABLE / REJECTED / REFUSED / UNVERIFIED, never in a fake success.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { createCiel } from '../../runtime.ts';
import { createInMemoryStore } from '../../adapters/memory/inMemoryStore.ts';
import { createWorld } from '../../capabilities/world.ts';
import { fixedClock } from '../../core/clock.ts';
import { sequentialIds } from '../../core/ids.ts';
import { createConfig } from '../../core/config.ts';
import { createMockProvider } from '../../adapters/intelligence/nullProvider.ts';
import { RunStatus } from '../../orchestrator.ts';
import { ReframeSource } from '../../engines/metaReasoning.ts';
import { IntakeKind } from '../../core/types.ts';

const aiOut = (decision, extra = {}) => ({
  type: 'plan', decision, alternatives: [], reasoning_summary: 'because', assumptions: [],
  evidence_needed: [], risks: [], confidence: { reasoning: 0.9, knowledge: 0.9 }, ...extra,
});

function aiRig({ responses, available = true, policy = {} }) {
  const store = createInMemoryStore();
  const world = createWorld({});
  const provider = createMockProvider({ name: 'mock', responses, available });
  const config = createConfig({ ai: { enabled: true, provider: 'mock' }, policy });
  const ciel = createCiel({
    store, clock: fixedClock(), newId: sequentialIds(), config, provider, providerAvailable: available,
    permissions: ['state:write', 'email:send'], world, withReferenceCapabilities: true,
  });
  return { ciel, provider, world, store };
}

const kvPlan = {
  goal: 'store then read a value',
  tasks: [
    { id: 'a', goal: 'write', action: { capability: 'kv.set', params: { key: 'k', value: 1 } }, verification: predicate('value', 'eq', 1) },
    { id: 'b', goal: 'read', action: { capability: 'kv.get', params: { key: 'k' } }, dependencies: ['a'], verification: predicate('value', 'eq', 1) },
  ],
};

suite('Phase I — Intake: an intention is classified before anything runs', (test) => {
  test('a greeting is a conversation, not a mission', async () => {
    const { ciel, store } = createRig();
    const r = await ciel.run('bonjour');
    assert.equal(r.status, RunStatus.NOT_EXECUTABLE);
    assert.equal(r.intake.kind, IntakeKind.CONVERSATION);
    assert.equal(r.mission, null);
    assert.equal((await store.find('missions', {})).length, 0, 'no mission may be created for a greeting');
  });

  test('a question is not executed as a mission', async () => {
    const { ciel } = createRig();
    const r = await ciel.run('pourquoi le ciel est bleu ?');
    assert.equal(r.status, RunStatus.NOT_EXECUTABLE);
    assert.equal(r.intake.kind, IntakeKind.QUESTION);
  });

  test('prose with an action marker and no AI is refused, with what is missing', async () => {
    const { ciel, store } = createRig();
    const r = await ciel.run('envoie un rapport au directeur');
    assert.equal(r.status, RunStatus.NOT_EXECUTABLE);
    assert.equal(r.intake.kind, IntakeKind.MISSION);
    assert.ok(r.requires.some((x) => x.includes('structured')), 'it must say what it needs');
    assert.equal((await store.find('missions', {})).length, 0);
  });

  test('an invalid structured plan is rejected with every reason', async () => {
    const { ciel } = createRig();
    const r = await ciel.run({ goal: 'broken', tasks: [{ id: 'a', action: { capability: 'kv.get' }, dependencies: ['ghost'] }] });
    assert.equal(r.status, RunStatus.REJECTED);
    assert.ok(r.errors.some((e) => e.includes('ghost')));
  });
});

suite('Phase I — A structured plan runs end to end', (test) => {
  test('intention -> mission -> verification -> ledger', async () => {
    const { ciel } = createRig();
    const r = await ciel.run(kvPlan);
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.outcome, 'COMPLETED_VERIFIED');
    assert.equal(r.verification.verified, 2);
    assert.equal(r.verification.records, 2);
    assert.equal(r.ledger.chain_ok, true, 'the hash chain must verify before a report is returned');
    assert.ok(r.ledger.count > 0);
    assert.equal(r.ledger.by_type.mission_created, 1);
    assert.equal(r.ai_calls, 0, 'no model is involved in a structured plan');
    assert.equal(r.ai_authored, false);
  });

  test('a plan needing an unknown capability is refused before any execution', async () => {
    const { ciel, store } = createRig();
    const r = await ciel.run({ goal: 'g', tasks: [{ id: 'a', action: { capability: 'shell.exec', params: {} } }] });
    assert.equal(r.status, RunStatus.REJECTED);
    assert.ok(r.errors.some((e) => e.includes('shell.exec')));
    assert.equal((await store.find('missions', {})).length, 0);
  });

  test('a task with no verifier never turns into a success', async () => {
    const { ciel } = createRig();
    const r = await ciel.run({ goal: 'unverifiable', tasks: [{ id: 'a', action: { capability: 'data.transform', params: { op: 'upper', value: 'x' } } }] });
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.outcome, 'COMPLETED_UNVERIFIED');
    assert.equal(r.verification.verified, 0);
    assert.equal(r.verification.unverified, 1);
  });

  test('a partially verified mission says so', async () => {
    const { ciel } = createRig();
    const r = await ciel.run({
      goal: 'one verified, one not',
      tasks: [
        { id: 'a', action: { capability: 'data.transform', params: { op: 'upper', value: 'x' } } },
        { id: 'b', action: { capability: 'data.transform', params: { op: 'upper', value: 'y' } }, verification: predicate('value', 'eq', 'Y') },
      ],
    });
    assert.equal(r.outcome, 'COMPLETED_PARTIALLY_VERIFIED');
    assert.equal(r.verification.verified, 1);
    assert.equal(r.verification.unverified, 1);
  });

  test('sufficiency refuses an irreversible action that cannot be verified', async () => {
    const { ciel } = createRig();
    const r = await ciel.run({
      goal: 'send a mail with no way to check it',
      tasks: [{ id: 'a', action: { capability: 'mail.send', params: { message_id: 'm1', to: 'x@y.z' } } }],
    });
    assert.equal(r.status, RunStatus.REFUSED);
    assert.equal(r.sufficiency.recommendation, 'REFUSE');
    assert.equal(r.mission, null, 'nothing may run when sufficiency refuses');
  });

  test('a budget that runs out ends BLOCKED, not successful', async () => {
    const { ciel } = createRig({ limits: { tool_calls: 1 } });
    const r = await ciel.run({
      goal: 'two calls, one allowed',
      tasks: [
        { id: 'a', action: { capability: 'data.transform', params: { op: 'upper', value: 'a' } }, verification: predicate('value', 'eq', 'A') },
        { id: 'b', action: { capability: 'data.transform', params: { op: 'upper', value: 'b' } }, verification: predicate('value', 'eq', 'B') },
      ],
    });
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.outcome, 'BLOCKED');
    assert.equal(r.verification.verified, 1);
  });

  test('the same mission repeated three times does not look like a loop', async () => {
    const { ciel } = createRig();
    const plan = { goal: 'single action', tasks: [{ id: 'a', action: { capability: 'data.transform', params: { op: 'upper', value: 'x' } }, verification: predicate('value', 'eq', 'X') }] };
    let lastMissionId = null;
    for (let i = 0; i < 3; i += 1) {
      const r = await ciel.run(plan);
      assert.equal(r.outcome, 'COMPLETED_VERIFIED', `run ${i + 1} must succeed`);
      assert.equal(r.ledger.by_type.loop_detected ?? 0, 0, `run ${i + 1} must not be flagged as a loop`);
      lastMissionId = r.mission.id;
    }
    assert.equal(ciel.loop.size({ mission_id: lastMissionId }), 1, 'each mission keeps its own history');
    assert.equal(ciel.loop.size(), 3, 'one record per mission: nothing was merged across missions');
  });
});

suite('Phase I — AI proposes, Ciel decides, a human confirms', (test) => {
  test('a model-written plan executes nothing until it is confirmed', async () => {
    const { ciel, store } = aiRig({ responses: [aiOut(kvPlan)] });
    const r = await ciel.run('écris la valeur 1 sous la clé k puis relis-la');
    assert.equal(r.status, RunStatus.AWAITING_CONFIRMATION);
    assert.equal(r.ai_authored, true);
    assert.equal(r.requires_confirmation, true);
    assert.ok(r.confirmation.plan_fingerprint.startsWith('sha256:'));
    assert.equal((await store.find('missions', {})).length, 0, 'nothing may run before the human answers');
    assert.equal(r.plan.goal, kvPlan.goal);
  });

  test('an unknown proposal id executes nothing', async () => {
    const { ciel, store } = aiRig({ responses: [aiOut(kvPlan)] });
    const r = await ciel.run(null, { confirm: 'proposal_does_not_exist' });
    assert.equal(r.status, RunStatus.REJECTED);
    assert.ok(r.reason.includes('no pending proposal'));
    assert.equal((await store.find('missions', {})).length, 0);
  });

  test('confirming by proposal id runs the approved plan, with no second model call', async () => {
    const { ciel, provider } = aiRig({ responses: [aiOut(kvPlan)] });
    const preview = await ciel.run('écris la valeur 1 sous la clé k puis relis-la');
    const r = await ciel.run(null, { confirm: preview.confirmation.proposal_id });
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.outcome, 'COMPLETED_VERIFIED');
    assert.equal(provider.callCount(), 1, 'confirmation must not cost another model call');
    assert.equal(r.ledger.chain_ok, true);
    assert.equal(r.plan.goal, kvPlan.goal, 'the executed plan is exactly the approved one');
  });

  test('a confirmation wins over the input sent alongside it', async () => {
    const { ciel } = aiRig({ responses: [aiOut(kvPlan)] });
    const preview = await ciel.run('écris la valeur 1 sous la clé k puis relis-la');
    // A caller that resends prose AND a confirmation must get the approved plan, not a new one.
    const r = await ciel.run('autre chose entièrement', { confirm: preview.confirmation.proposal_id });
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.plan.goal, kvPlan.goal, 'the stored proposal governs, not the new text');
  });

  test('the same proposal cannot be accepted twice', async () => {
    const { ciel, store } = aiRig({ responses: [aiOut(kvPlan)] });
    const preview = await ciel.run('écris la valeur 1 sous la clé k puis relis-la');
    await ciel.run(null, { confirm: preview.confirmation.proposal_id });
    const again = await ciel.run(null, { confirm: preview.confirmation.proposal_id });
    assert.equal(again.status, RunStatus.REJECTED);
    assert.ok(again.reason.includes('already accepted'));
    assert.equal((await store.find('missions', {})).length, 1, 'exactly one mission was created');
  });

  test('a proposal altered after approval is refused', async () => {
    const { ciel, store } = aiRig({ responses: [aiOut(kvPlan)] });
    const preview = await ciel.run('écris la valeur 1 sous la clé k puis relis-la');
    const stored = await store.get('proposals', preview.confirmation.proposal_id);
    await store.put('proposals', {
      ...stored,
      plan: { ...stored.plan, tasks: stored.plan.tasks.map((t) => ({ ...t, action: { ...t.action, params: { ...t.action.params, value: 999 } } })) },
    });
    const r = await ciel.run(null, { confirm: preview.confirmation.proposal_id });
    assert.equal(r.status, RunStatus.REJECTED);
    assert.ok(r.reason.includes('fingerprint mismatch'));
    assert.equal((await store.find('missions', {})).length, 0, 'a tampered proposal must not run');
  });

  test('a proposal using a capability Ciel does not have is rejected', async () => {
    const { ciel, store } = aiRig({ responses: [aiOut({ goal: 'g', tasks: [{ id: 'a', action: { capability: 'shell.exec', params: {} } }] })] });
    const r = await ciel.run('supprime les logs');
    assert.equal(r.status, RunStatus.REJECTED);
    assert.ok(r.errors.some((e) => e.includes('shell.exec')));
    assert.equal((await store.find('missions', {})).length, 0);
  });

  test('a provider that is down degrades honestly instead of inventing a plan', async () => {
    const { ciel } = aiRig({ responses: [aiOut(kvPlan)], available: false });
    const r = await ciel.run('envoie un rapport');
    assert.equal(r.status, RunStatus.AI_UNAVAILABLE);
    assert.equal(r.plan, null);
  });
});

suite('Phase I — Failure paths are reported, not hidden', (test) => {
  test('a failing capability ends FAILED and triggers a recorded meta-reasoning pass', async () => {
    const { ciel } = createRig();
    const r = await ciel.run({ goal: 'an action that always fails', tasks: [{ id: 'a', action: { capability: 'always.fails', params: {} } }] });
    assert.equal(r.status, RunStatus.EXECUTED);
    assert.equal(r.outcome, 'FAILED');
    assert.equal(r.verification.failed, 1);
    assert.ok(r.reframe, 'meta-reasoning must be consulted on failure');
    assert.equal(r.reframe.source, ReframeSource.NONE, 'with AI disabled there is no proposal to make');
    assert.equal(r.reframe.requires_user, true);
    assert.ok(r.ledger.by_type.diagnostic_recorded >= 2, 'the failure and the reframe are both journaled');
  });

  test('a declared fallback is preferred over asking the user', async () => {
    const { ciel } = aiRig({ responses: [], available: false });
    const r = await ciel.run({
      goal: 'a task with a declared fallback',
      tasks: [{
        id: 'a',
        action: { capability: 'always.fails', params: {} },
        fallback: { action: { capability: 'data.transform', params: { op: 'upper', value: 'ok' } } },
      }],
    });
    assert.equal(r.outcome, 'FAILED');
    assert.equal(r.reframe.source, ReframeSource.DECLARED_FALLBACK);
    assert.equal(r.reframe.requires_user, false);
    // The fallback is *reported*, not silently executed: replaying work is an explicit decision.
    assert.equal(r.reframe.requires_verification, true);
  });

  test('the report always carries the chain verdict', async () => {
    const { ciel } = createRig();
    const r = await ciel.run(kvPlan);
    assert.equal(typeof r.ledger.chain_ok, 'boolean');
    const mission = await ciel.store.get('missions', r.mission.id);
    assert.equal(mission.status, 'COMPLETED_VERIFIED');
    assert.equal((await ciel.ledger.verify(r.mission.id)).ok, true);
  });
});
