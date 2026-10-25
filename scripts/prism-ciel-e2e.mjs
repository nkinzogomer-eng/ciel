// EXTERNAL, isolated-CI runtime demonstration: a real Ciel mission invokes
// PRISM's pinned source-only Python scanner. NOT part of the browser bundle,
// not a production sandbox/authorization service.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createCiel } from '../base44/shared/ciel/runtime.ts';
import { createConfig } from '../base44/shared/ciel/core/config.ts';
import { RuntimeRequirement } from '../base44/shared/ciel/core/types.ts';
import { createInMemoryStore } from '../base44/shared/ciel/adapters/memory/inMemoryStore.ts';
import { createPrismDiscoveryCapability } from '../base44/shared/ciel/capabilities/prismDiscovery.ts';

const [prismRootArg, sourcePathArg, chosenAdapter = 'starlette_static'] = process.argv.slice(2);
if (!['starlette_static', 'django_safe_join'].includes(chosenAdapter)) throw new Error('unapproved external adapter');
if (!prismRootArg || !sourcePathArg) throw new Error('Usage: prism-ciel-e2e.mjs <prism-repo> <pinned-source-file>');
const prismRoot = realpathSync(prismRootArg);
const source = realpathSync(sourcePathArg);
const allowedRoot = realpathSync(resolve(source, '..', '..'));
if (!source.startsWith(allowedRoot + sep)) throw new Error('source must be inside authorized local clone');
const sourceSha = createHash('sha256').update(readFileSync(source)).digest('hex');
const temp=mkdtempSync(join(tmpdir(),'ciel-prism-e2e-'));
let calls=0;
let lastPrismResult=null;
try {
  const runPrism=async ({adapter,source_path,source_sha256,max_probes,mission_id,task_id})=>{
    calls+=1;
    if (adapter!==chosenAdapter) throw new Error('unexpected external adapter');
    if (source_path!==source || source_sha256!==sourceSha) throw new Error('unexpected source');
    const out=join(temp,'result.json');
    const cmd=[
      '-m','scripts.d24g_source_only_discover',
      '--authorized-local','--adapter',adapter,
      '--source',source_path,'--max-probes',String(max_probes),
      '--mission-id',mission_id,'--task-id',task_id,
      '--out',out,
    ];
    const proc=spawnSync('python3',cmd,{
      cwd:prismRoot,timeout:90000,encoding:'utf8',shell:false,
      env:{...process.env, PYTHONPATH:prismRoot},
      maxBuffer:1024*1024,
    });
    if(proc.status!==0)throw new Error(
      'PRISM external process failed '+proc.status+'\n'+proc.stderr+'\n'+proc.stdout
    );
    lastPrismResult=JSON.parse(readFileSync(join(temp,'result.ciel.json'),'utf8'));
    return lastPrismResult;
  };
  const authorizeSource=async ({source_path,source_sha256})=>
    source_path===source && source_sha256===sourceSha &&
    realpathSync(source_path)===source && source.startsWith(allowedRoot+sep);
  const store=createInMemoryStore();
  const ciel=createCiel({
    store, config:createConfig(), permissions:['cyber:local-audit'],
    runtime:RuntimeRequirement.EXTERNAL,
  });
  const cap=createPrismDiscoveryCapability({runPrism,authorizeSource});
  ciel.registry.register(cap);
  if(!ciel.registry.check('prism.cyber.discovery').allowed)throw new Error('policy denied configured local capability');
  if(ciel.ai_enabled)throw new Error('PRISM mission must run with AI disabled');
  const task={
    id:'local-audit',goal:'Test authorized local path containment',
    action:{capability:'prism.cyber.discovery',params:{
      adapter:chosenAdapter,source_path:source,
      source_sha256:sourceSha,max_probes:64,
    }},
    // Critically, no independent verifier registered in this phase.
    // Ciel must refuse to claim VERIFIED.
  };
  const {mission}=await ciel.compiler.compile({goal:'Check allowed pinned local package behavior',tasks:[task]});
  const execution=await ciel.executor.run(mission.id);
  if(calls!==1)throw new Error('Ciel did not invoke PRISM exactly once');
  const expectedVerdict=chosenAdapter==='django_safe_join' ? 'NO_WITNESS_NOT_SAFE' : 'LOCAL_PROPERTY_WITNESS';
  if(lastPrismResult?.observation?.status!==expectedVerdict)
    throw new Error('unexpected untrusted PRISM result status: '+lastPrismResult?.observation?.status);

  if(execution.outcome==='COMPLETED_VERIFIED')throw new Error('Ciel falsely marked security proof VERIFIED');
  if(!['COMPLETED_UNVERIFIED','COMPLETED_PARTIALLY_VERIFIED'].includes(execution.outcome))
    throw new Error('Unexpected Ciel state: '+execution.outcome);
  const out={
    schema:'scm.prism.ciel-live-external-mission.v1',
    source_sha256:sourceSha,
    permission:'cyber:local-audit',
    runtime:'EXTERNAL',
    calls,
    adapter:chosenAdapter,
    prism_status:lastPrismResult.observation.status,
    observed_property_violations:lastPrismResult.observation.observed_property_violations,
    ai_enabled:ciel.ai_enabled,
    ciel_mission_outcome:execution.outcome,
    verified_by_independent_ciel_engine:false,
    source_only_no_patch_in_runtime:true,
    novel_vulnerability_confirmed:false,
  };
  console.log('D24G_CIEL_REAL_MISSION',JSON.stringify(out));
} finally {
  rmSync(temp,{recursive:true,force:true});
}
