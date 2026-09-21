// Ciel runtime assembly. Pure composition: nothing here knows about Base44.
// The same factory is used by the test harness, by the Base44 surface and (unchanged)
// by an external Deno/Node runtime.
import { SystemClock, assertClock } from './core/clock.ts';
import { newId as randomId } from './core/ids.ts';
import { createConfig, degradationLevel } from './core/config.ts';
import { RuntimeRequirement } from './core/types.ts';
import { createCapabilityRegistry } from './engines/capabilityRegistry.ts';
import { createLedgerService } from './engines/ledgerService.ts';
import { createCheckpointService } from './engines/checkpointService.ts';
import { createRecoveryEngine } from './engines/recoveryEngine.ts';
import { createVerificationEngine } from './engines/verificationEngine.ts';
import { createLoopDetector } from './engines/loopDetector.ts';
import { createLearningEngine } from './engines/learning.ts';
import { createMissionCompiler } from './engines/missionCompiler.ts';
import { createExecutor } from './engines/executor.ts';
import { registerReferenceCapabilities } from './capabilities/reference.ts';
import { createPlanSynthesizer } from './engines/planSynthesis.ts';
import { createMetaReasoner } from './engines/metaReasoning.ts';
import { assertIntelligenceProvider } from './interfaces/intelligenceProvider.ts';

export function createCiel({
  store, clock = SystemClock, newId = randomId, config = createConfig(), provider = null,
  permissions = [], runtime = RuntimeRequirement.ANY, world = null, withReferenceCapabilities = false,
  providerAvailable = null,
}) {
  assertClock(clock);
  if (provider) assertIntelligenceProvider(provider);
  const registry = createCapabilityRegistry({ permissions, runtime });
  if (withReferenceCapabilities) registerReferenceCapabilities(registry, world);

  const ledger = createLedgerService({ store, clock });
  const checkpoints = createCheckpointService({ store, clock, newId, ledger });
  const recovery = createRecoveryEngine({ store, clock, ledger, registry });
  const verifier = createVerificationEngine({ clock, newId, registry });
  const loop = createLoopDetector({ threshold: config.policy.loop_threshold });
  const learning = createLearningEngine({ store, clock, newId, ledger });
  const compiler = createMissionCompiler({ store, clock, newId, ledger, registry, config });
  const executor = createExecutor({ store, clock, newId, ledger, checkpoints, registry, verifier, loop, config, learning });
  const synthesizer = createPlanSynthesizer({ provider, registry, config });
  const meta = createMetaReasoner({ provider, config, clock, newId });

  return {
    config, store, clock, newId, world, provider,
    registry, ledger, checkpoints, recovery, verifier, loop, learning, compiler, executor, synthesizer, meta,
    // Reachability is checked by the caller (isAvailable is async); unknown means "not reachable".
    degradation: degradationLevel(config, provider ? Boolean(providerAvailable ?? provider.available) : false),
    ai_enabled: config.ai.enabled,
  };
}