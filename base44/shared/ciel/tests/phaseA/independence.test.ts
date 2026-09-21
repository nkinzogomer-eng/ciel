import { suite, assert } from '../runner.ts';
import { DegradationLevel, ComponentStatus, RuntimeRequirement } from '../../core/types.ts';
import { createConfig, degradationLevel, DEFAULT_CONFIG } from '../../core/config.ts';
import { createNullProvider, createMockProvider } from '../../adapters/intelligence/nullProvider.ts';
import { assertIntelligenceProvider, validateAiOutput, createCognitiveContext } from '../../interfaces/intelligenceProvider.ts';
import { createManifest, validateManifest, assertCapability } from '../../interfaces/capability.ts';
import { assertMemoryStore } from '../../interfaces/memoryStore.ts';
import { createInMemoryStore } from '../../adapters/memory/inMemoryStore.ts';
import { validatePlan, instantiatePlan } from '../../domain/plan.ts';
import { sequentialIds } from '../../core/ids.ts';
import { fixedClock } from '../../core/clock.ts';

const now = fixedClock().now();

const goodAiOutput = {
  type: 'decision', decision: 'a', alternatives: ['b'], reasoning_summary: 'because',
  assumptions: [], evidence_needed: ['check file'], risks: [], confidence: { reasoning: 0.7, knowledge: 0.5 },
};

suite('Phase A · Independence from AI and from the platform', (test) => {
  test('AI is disabled by default and the system runs in CORE_ONLY', () => {
    assert.equal(DEFAULT_CONFIG.ai.enabled, false);
    const cfg = createConfig();
    assert.equal(degradationLevel(cfg, false), DegradationLevel.CORE_ONLY);
    assert.equal(degradationLevel(cfg, true), DegradationLevel.CORE_ONLY);
    assert.equal(cfg.budget.default_limits.ai_calls, 0);
  });

  test('enabling AI requires a provider, and single_provider forbids a fallback', () => {
    assert.throws(() => createConfig({ ai: { enabled: true } }), 'INVALID_CONFIG');
    assert.throws(() => createConfig({ ai: { enabled: true, provider: 'anthropic', fallback: 'openai' } }), 'INVALID_CONFIG');
    const cfg = createConfig({ ai: { enabled: true, provider: 'anthropic' } });
    assert.equal(degradationLevel(cfg, true), DegradationLevel.FULL);
    assert.equal(degradationLevel(cfg, false), DegradationLevel.REDUCED);
  });

  test('a mission plan is validated and instantiated with ZERO AI calls', () => {
    const provider = createNullProvider();
    assertIntelligenceProvider(provider);
    const plan = { goal: 'offline mission', tasks: [
      { id: 'a', action: { capability: 'compute.arithmetic', params: { expr: '1+1' } } },
      { id: 'b', action: { capability: 'ciel.report' }, dependencies: ['a'] },
    ] };
    assert.equal(validatePlan(plan).ok, true);
    const { mission, tasks } = instantiatePlan(plan, { missionId: 'm1', newId: sequentialIds('t'), now });
    assert.equal(mission.status, 'CREATED');
    assert.equal(tasks.length, 2);
    assert.equal(provider.callCount(), 0, 'the offline path must never touch the provider');
  });

  test('the null provider is never available and refuses every call', async () => {
    const provider = createNullProvider();
    assert.equal(await provider.isAvailable(), false);
    await assert.rejects(() => provider.evaluate({ kind: 'decision' }), 'AI_UNAVAILABLE');
    assert.equal(provider.callCount(), 1);
  });

  test('raw text and malformed structures are rejected as AI output', () => {
    assert.equal(validateAiOutput(goodAiOutput).ok, true);
    assert.equal(validateAiOutput('the answer is a').ok, false);
    assert.equal(validateAiOutput({ ...goodAiOutput, risks: 'none' }).ok, false);
    assert.equal(validateAiOutput({ ...goodAiOutput, confidence: { reasoning: 2, knowledge: 0.5 } }).ok, false);
    const { decision, ...missing } = goodAiOutput;
    assert.equal(validateAiOutput(missing).ok, false);
  });

  test('the cognitive context cannot leak arbitrary mission internals', () => {
    assert.throws(() => createCognitiveContext({ goal: 'g', question: 'q', required_output_format: 'json', ledger: ['...'] }), 'CONTEXT_LEAK');
    assert.throws(() => createCognitiveContext({ goal: 'g' }), 'INVALID_CONTEXT');
    const ctx = createCognitiveContext({ goal: 'g', question: 'q', required_output_format: 'json', unknowns: ['x'] });
    assert.equal(ctx.goal, 'g');
  });

  test('a mock provider can be scripted, and the Core keeps working when it turns unavailable', async () => {
    const p = createMockProvider({ responses: [goodAiOutput] });
    assert.equal(validateAiOutput(await p.evaluate({ kind: 'decision', question: 'q' })).ok, true);
    assert.equal(p.requests()[0].question, 'q');
    const down = createMockProvider({ available: false });
    await assert.rejects(() => down.evaluate({ kind: 'decision' }), 'AI_UNAVAILABLE');
  });

  test('a non-idempotent capability without probeEffect() is refused at registration', () => {
    const manifest = createManifest({ name: 'payment.charge', description: 'charge a card', idempotent: false, reversible: false, side_effects: ['payment'], permissions: ['payment:write'] });
    assert.throws(() => assertCapability({ manifest, execute: async () => ({ output: null }) }), 'PROBE_REQUIRED');
    assertCapability({ manifest, execute: async () => ({ output: null }), probeEffect: async () => ({ occurred: false, evidence: null }) });
  });

  test('a side-effecting capability must declare its permissions, and external runtimes are marked honestly', () => {
    assert.equal(validateManifest({ name: 'fs.write', version: '1', description: 'd', idempotent: true, reversible: true, side_effects: ['file'], permissions: [], requires_runtime: 'EXTERNAL', status: 'STUB' }).ok, false);
    const shell = createManifest({ name: 'shell.exec', description: 'run a command', idempotent: false, reversible: false, side_effects: ['process'], permissions: ['shell:exec'], requires_runtime: RuntimeRequirement.EXTERNAL, status: ComponentStatus.REQUIRES_EXTERNAL_RUNTIME });
    assert.equal(shell.status, ComponentStatus.REQUIRES_EXTERNAL_RUNTIME);
    assert.throws(() => createManifest({ name: 'Bad Name', description: 'd', idempotent: true, reversible: true }), 'INVALID_MANIFEST');
  });

  test('the store contract is satisfiable without any platform dependency', async () => {
    const store = createInMemoryStore();
    assertMemoryStore(store);
    await store.put('missions', { id: 'm1', goal: 'g' });
    assert.equal((await store.get('missions', 'm1')).goal, 'g');
    assert.equal((await store.find('missions', { goal: 'g' })).length, 1);
    await assert.rejects(() => store.put('nope', { id: 'x' }), 'UNKNOWN_COLLECTION');
    await assert.rejects(() => store.put('missions', { goal: 'no id' }), 'MISSING_ID');
    // Records are cloned in and out: external mutation cannot corrupt the store.
    const got = await store.get('missions', 'm1');
    got.goal = 'mutated';
    assert.equal((await store.get('missions', 'm1')).goal, 'g');
    await store.remove('missions', 'm1');
    assert.equal(await store.get('missions', 'm1'), null);
  });
});