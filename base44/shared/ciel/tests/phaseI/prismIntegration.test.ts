// Phase I — live-independent PRISM capability boundary tests (no LLM).
import { suite, assert } from '../runner.ts';
import { createPrismDiscoveryCapability, validatePrismEnvelope } from '../../capabilities/prismDiscovery.ts';
import { createCapabilityRegistry } from '../../engines/capabilityRegistry.ts';
import { RuntimeRequirement } from '../../core/types.ts';

const digest = 'a'.repeat(64);
function evidence(mission_id = 'm', task_id = 't') {
  const violation = {
    identifier: 'probe-1',
    payload: '../sibling',
    expected: 'DENY',
    observed: 'ALLOW',
    violation: true,
    derivation: 'independent path boundary property',
    witness: 'sibling',
  };
  return {
    schema: 'scm.prism.ciel-capability.v1',
    capability: 'prism.cyber.discovery',
    mission_id, task_id, execution_policy: 'LOCAL_READ_ONLY',
    requires_external_runtime: true, ciel_verification_state: 'UNVERIFIED',
    needs_independent_attestation: true, claim_of_new_vulnerability: false,
    observation: {
      schema: 'scm.prism.discovery.v1', status: 'LOCAL_PROPERTY_WITNESS',
      target: { project: 'demo', source_sha256: digest, security_property: 'containment' },
      budget: { max_probes: 4, used_probes: 1 },
      hypotheses_generated: 1, observed_property_violations: 1,
      minimal_observed_witness: violation,
      observations: [violation], all_violations: [violation], replay_sha256: 'f'.repeat(64),
      verification: { previously_unknown_vulnerability_confirmed: false,
                      overall_program_safety_proved: false },
    },
  };
}

const request = { adapter: 'starlette_static', source_path: '/scoped/project/file.py',
                  source_sha256: digest, max_probes: 4 };

suite('Phase I — PRISM typed source-only Ciel adapter', (test) => {
  test('requires explicit EXTERNAL runtime and policy permission', () => {
    const cap=createPrismDiscoveryCapability({
      runPrism: async()=>evidence(),
      authorizeSource: async()=>true,
    });
    const browser=createCapabilityRegistry({runtime:RuntimeRequirement.ANY,permissions:['cyber:local-audit']});
    browser.register(cap);
    assert.equal(browser.check('prism.cyber.discovery').code,'RUNTIME_UNAVAILABLE');
    const external=createCapabilityRegistry({runtime:RuntimeRequirement.EXTERNAL});
    external.register(cap);
    assert.equal(external.check('prism.cyber.discovery').code,'PERMISSION_DENIED');
    external.grant('cyber:local-audit');
    assert.equal(external.check('prism.cyber.discovery').allowed,true);
  });

  test('policy authorizer denies even if callers set authorized true', async () => {
    const cap=createPrismDiscoveryCapability({
      runPrism:async()=>{throw Error('runner should not execute');},
      authorizeSource:async()=>false,
    });
    await assert.rejects(() => cap.execute({...request,authorized:true},
                                          {mission_id:'m',task_id:'t'}),'PRISM_SCOPE');
  });

  test('validated evidence stays UNVERIFIED after a matching run', async () => {
    const cap=createPrismDiscoveryCapability({runPrism:async()=>evidence(),
                                             authorizeSource:async()=>true});
    const actual=await cap.execute(request,{mission_id:'m',task_id:'t'});
    assert.equal(actual.output.prism_verdict,'LOCAL_PROPERTY_WITNESS');
    assert.equal(actual.output.verification_state,'UNVERIFIED');
    assert.equal(actual.output.independent_replay_required,true);
    assert.equal(actual.output.claimed_novel_vulnerability,false);
  });

  test('a fabricated model VERIFIED assertion is rejected', async () => {
    const untrusted=evidence();untrusted.ciel_verification_state='VERIFIED';
    assert.throws(()=>validatePrismEnvelope(untrusted,
      {mission_id:'m',task_id:'t',source_sha256:digest}),'PRISM_TRUST');
  });

  test('mismatched code fingerprint or mission are refused', async () => {
    assert.throws(()=>validatePrismEnvelope(evidence(),
      {mission_id:'m',task_id:'t',source_sha256:'b'.repeat(64)}),'PRISM_EVIDENCE');
    assert.throws(()=>validatePrismEnvelope(evidence('other'),
      {mission_id:'m',task_id:'t',source_sha256:digest}),'PRISM_CORRELATION');
  });

  test('no-witness is never presented as proof of safety', () => {
    const r=evidence();
    r.observation.status='NO_WITNESS_NOT_SAFE';
    assert.throws(()=>validatePrismEnvelope(r,
      {mission_id:'m',task_id:'t',source_sha256:digest}),'PRISM_EVIDENCE');
    r.observation.minimal_observed_witness=null;
    r.observation.observed_property_violations=0;
    const accepted=validatePrismEnvelope(r,
      {mission_id:'m',task_id:'t',source_sha256:digest});
    assert.equal(accepted.status,'NO_WITNESS_NOT_SAFE');
  });

  test('input requires sha, bounded budget and valid target adapter', async () => {
    const cap=createPrismDiscoveryCapability({runPrism:async()=>evidence(),
                                             authorizeSource:async()=>true});
    await assert.rejects(()=>cap.execute({...request,max_probes:0},
                         {mission_id:'m',task_id:'t'}),'PRISM_PARAMS');
    await assert.rejects(()=>cap.execute({...request,adapter:'remote_target'},
                         {mission_id:'m',task_id:'t'}),'PRISM_PARAMS');
  });
});
