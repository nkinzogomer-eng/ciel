// Phase H — the optional intelligence layer. Everything here proves the SAME point:
// a model may propose, Ciel decides, and a bad proposal never reaches execution.
import { suite, assert } from '../runner.ts';
import { createRig, predicate } from '../helpers/rig.ts';
import { createCiel } from '../../runtime.ts';
import { createInMemoryStore } from '../../adapters/memory/inMemoryStore.ts';
import { createWorld } from '../../capabilities/world.ts';
import { fixedClock } from '../../core/clock.ts';
import { sequentialIds } from '../../core/ids.ts';
import { createConfig } from '../../core/config.ts';
import { createMockProvider } from '../../adapters/intelligence/nullProvider.ts';
import { createLlmProvider } from '../../adapters/intelligence/base44Provider.ts';
import { SynthesisOutcome } from '../../engines/planSynthesis.ts';
import { ReframeSource } from '../../engines/metaReasoning.ts';
import { assessSufficiency, Sufficiency } from '../../engines/sufficiency.ts';
import { EpistemicLevel } from '../../core/types.ts';
import { RiskClass } from '../../domain/actionGraph.ts';
import { overallConfidence } from '../../domain/confidence.ts';

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

const goodPlan = {
  goal: 'store then read a value',
  tasks: [
    { id: 'a', action: { capability: 'kv.set', params: { key: 'k', value: 1 } }, verification: predicate('value', 'eq', 1) },
    { id: 'b', action: { capability: 'kv.get', params: { key: 'k' } }, dependencies: ['a'], verification: predicate('value', 'eq', 1) },
  ],
};

suite('Phase H — Plan synthesis (AI proposes, Ciel validates)', (test) => {
  test('with AI disabled, synthesis refuses instead of inventing a plan', async () => {
    const { ciel } = createRig();
    const r = await ciel.synthesizer.synthesize('envoie un rapport');
    assert.equal(r.outcome, SynthesisOutcome.AI_UNAVAILABLE);
    assert.equal(r.plan, null);
    assert.equal(r.requires.length, 1);
  });

  test('a valid proposal is accepted but still requires confirmation', async () => {
    const { ciel } = aiRig({ responses: [aiOut(goodPlan)] });
    const r = await ciel.synthesizer.synthesize('stocke puis relis une valeur');
    assert.equal(r.outcome, SynthesisOutcome.PROPOSED);
    assert.equal(r.requires_confirmation, true);
    assert.equal(r.provenance.made_by, 'ai:mock');
    // The model claimed 0.9; Ciel's own confidence is still zero.
    assert.equal(overallConfidence(r.provenance.confidence), 0);
    assert.equal(r.provenance.confidence.claimed.reasoning, 0.9);
  });

  test('a proposal using an invented capability is rejected, not repaired', async () => {
    const { ciel } = aiRig({ responses: [aiOut({ goal: 'g', tasks: [{ id: 'a', action: { capability: 'shell.exec', params: {} } }] })] });
    const r = await ciel.synthesizer.synthesize('supprime les logs');
    assert.equal(r.outcome, SynthesisOutcome.REJECTED);
    assert.ok(r.errors.some((e) => e.includes('shell.exec')));
    assert.equal(r.plan, null);
  });

  test('a structurally broken proposal is rejected with every reason', async () => {
    const { ciel } = aiRig({ responses: [aiOut({ goal: '', tasks: [{ id: 'a', action: { capability: 'kv.get' }, dependencies: ['ghost'] }] })] });
    const r = await ciel.synthesizer.synthesize('fais quelque chose');
    assert.equal(r.outcome, SynthesisOutcome.REJECTED);
    assert.ok(r.errors.length >= 2);
  });

  test('a provider returning raw text breaks the output contract and counts as unavailable', async () => {
    const provider = createLlmProvider({ invokeLLM: async () => 'bien sûr, voici le plan !' });
    await assert.rejects(() => provider.evaluate({ kind: 'compile_plan', context: { goal: 'g', question: 'q', required_output_format: 'json' } }), 'AI_UNAVAILABLE');
    assert.equal(provider.callCount(), 1);
    assert.ok(provider.errors()[0].includes('raw text'));
  });

  test('an accepted proposal compiles and executes through the normal deterministic path', async () => {
    const { ciel } = aiRig({ responses: [aiOut(goodPlan)] });
    const r = await ciel.synthesizer.synthesize('stocke puis relis');
    const compiled = await ciel.compiler.compile(r.plan, { source: 'ai_plan' });
    const report = await ciel.executor.run(compiled.mission.id, { world: ciel.world });
    assert.equal(report.outcome, 'COMPLETED_VERIFIED');
    // Exactly one AI call for the whole mission: execution itself needs no model.
    assert.equal(ciel.provider.callCount(), 1);
  });
});

suite('Phase H — Meta-reasoning (reframing after failure)', (test) => {
  test('a declared fallback is used without consulting any model', async () => {
    const { ciel, provider } = aiRig({ responses: [aiOut({ option: 'x' })] });
    const r = await ciel.meta.reframe({
      mission_id: 'm1', goal: 'g', failure: 'timeout',
      task: { id: 't1', fallback: { capability: 'kv.get', params: { key: 'k' } } },
    });
    assert.equal(r.source, ReframeSource.DECLARED_FALLBACK);
    assert.equal(provider.callCount(), 0);
    assert.equal(r.requires_verification, true);
  });

  test('with AI disabled and no fallback, Ciel asks the user instead of improvising', async () => {
    const { ciel } = createRig();
    const r = await ciel.meta.reframe({ mission_id: 'm1', goal: 'g', failure: 'timeout' });
    assert.equal(r.source, ReframeSource.NONE);
    assert.equal(r.requires_user, true);
  });

  test('an AI alternative is ranked by arbitration and stays UNCERTAIN', async () => {
    const { ciel } = aiRig({ responses: [aiOut(
      { option: 'retry over http', risk: 'low', evidence: [{ id: 'e1', source: 's1', level: EpistemicLevel.VERIFIED_FACT }, { id: 'e2', source: 's2', level: EpistemicLevel.CORROBORATED_INFERENCE }] },
      { alternatives: [{ option: 'give up', risk: 'high', evidence: [{ id: 'e3', source: 's1', level: EpistemicLevel.HYPOTHESIS }] }] },
    )] });
    const r = await ciel.meta.reframe({ mission_id: 'm1', goal: 'g', failure: 'connection refused' });
    assert.equal(r.source, ReframeSource.AI_PROPOSAL);
    assert.equal(r.proposal, 'retry over http');
    assert.equal(r.decision.validity, 'UNCERTAIN');
    assert.equal(r.decision.verification_required, true);
    assert.equal(r.decision.made_by, 'ai:mock');
  });

  test('indistinguishable alternatives are handed to the user, never coin-flipped', async () => {
    const ev = (id) => [{ id, source: 's1', level: EpistemicLevel.CORROBORATED_INFERENCE }];
    const { ciel } = aiRig({ responses: [aiOut(
      { option: 'A', risk: 'low', evidence: ev('e1') },
      { alternatives: [{ option: 'B', risk: 'low', evidence: ev('e2') }] },
    )] });
    const r = await ciel.meta.reframe({ mission_id: 'm1', goal: 'g', failure: 'f' });
    assert.equal(r.proposal, null);
    assert.equal(r.requires_user, true);
    assert.ok(r.reason.includes('arbitration refused'));
  });

  test('reframing is capped by policy', async () => {
    const { ciel } = aiRig({ responses: [aiOut({ option: 'x' })], policy: { max_reframes_per_mission: 2 } });
    const r = await ciel.meta.reframe({ mission_id: 'm1', goal: 'g', failure: 'f', reframes_used: 2 });
    assert.equal(r.exhausted, true);
    assert.equal(r.requires_user, true);
  });

  test('an unreachable provider degrades to asking the user', async () => {
    const { ciel } = aiRig({ responses: [], available: false });
    assert.equal(ciel.degradation, 'REDUCED');
    const r = await ciel.meta.reframe({ mission_id: 'm1', goal: 'g', failure: 'f' });
    assert.equal(r.requires_user, true);
  });
});

suite('Phase H — Cognitive sufficiency', (test) => {
  test('sufficient knowledge with a verifier allows acting', () => {
    const r = assessSufficiency({ goal: 'g', claims: [{ id: 'c1', critical: true, level: EpistemicLevel.VERIFIED_FACT }] });
    assert.equal(r.recommendation, Sufficiency.ACT);
    assert.equal(r.sufficient, true);
  });

  test('a blocking unknown means gather evidence, not act', () => {
    const r = assessSufficiency({ goal: 'g', unknowns: [{ question: 'which host?' }] });
    assert.equal(r.recommendation, Sufficiency.GATHER_EVIDENCE);
    assert.equal(r.missing_evidence[0], 'which host?');
  });

  test('a critical claim that is only a hypothesis is not enough', () => {
    const r = assessSufficiency({ goal: 'g', claims: [{ id: 'c1', critical: true, level: EpistemicLevel.HYPOTHESIS }] });
    assert.equal(r.recommendation, Sufficiency.GATHER_EVIDENCE);
  });

  test('contradicting claims go to the user', () => {
    const r = assessSufficiency({ goal: 'g', claims: [{ id: 'c1', contradicted: true }] });
    assert.equal(r.recommendation, Sufficiency.ASK_USER);
  });

  test('an irreversible action with no verifier is refused', () => {
    const r = assessSufficiency({ goal: 'g', risk_class: RiskClass.IRREVERSIBLE, verification_available: false });
    assert.equal(r.recommendation, Sufficiency.REFUSE);
    assert.equal(r.sufficient, false);
  });

  test('a reversible action with no verifier asks first', () => {
    const r = assessSufficiency({ goal: 'g', risk_class: RiskClass.REVERSIBLE, verification_available: false });
    assert.equal(r.recommendation, Sufficiency.ASK_USER);
  });
});