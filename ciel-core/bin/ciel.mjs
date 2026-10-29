#!/usr/bin/env node
// Ciel CLI — the same core, without Base44.
//
//   node --experimental-strip-types ciel-core/bin/ciel.mjs <command>
//   deno run --allow-net --allow-env ciel-core/bin/ciel.mjs <command>
//   bun ciel-core/bin/ciel.mjs <command>
//
// Commands
//   test [--json] [--verbose]     run the full A→I suite
//   status                        the honesty registry
//   run <file|-> [--json]         execute a structured plan (JSON file or stdin)
//   serve [--port N] [--data <dir>] [--allow-anon] [--cors]
//
// Node < 22.18 needs --experimental-strip-types to import .ts files. Rather than fail with a
// stack trace, this script explains that if the import is refused.
import { randomBytes } from 'node:crypto';

const argv = process.argv.slice(2);
const command = argv[0] || 'help';
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));
const has = (f) => flags.has(`--${f}`);

const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// Dynamic imports so that a plain `node ciel.mjs test` fails with an explanation, not a stack.
async function load(relative) {
  try {
    return await import(new URL(relative, import.meta.url).href);
  } catch (e) {
    const isTsRefusal = /Unknown file extension|Cannot find module|Unexpected token 'export'|ERR_UNKNOWN_FILE_EXTENSION|strip-types/i.test(e.message);
    if (!isTsRefusal) throw e;
    console.error(C.red('\nCe runtime Node ne sait pas importer du TypeScript directement.\n'));
    console.error('Utilisez l\'un de ces lancements :');
    console.error('  node --experimental-strip-types ciel-core/bin/ciel.mjs ' + command);
    console.error('  bun ciel-core/bin/ciel.mjs ' + command);
    console.error('  deno run --allow-net --allow-env ciel-core/bin/ciel.mjs ' + command + '\n');
    console.error(C.dim(`(détail : ${e.message})`));
    process.exit(1);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readPlan(source) {
  const fs = await import('node:fs/promises');
  const raw = source === '-' ? await readStdin() : await fs.readFile(source, 'utf8');
  return JSON.parse(raw);
}

async function cmdTest() {
  const { runAll } = await load('../tests/index.ts');
  const report = await runAll();
  if (has('json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const suite of report.suites) {
      const mark = suite.failed ? C.red('✗') : C.green('✓');
      console.log(`${mark} ${C.bold(suite.name)}  ${C.dim(`${suite.passed}/${suite.passed + suite.failed}`)}`);
      if (has('verbose') || suite.failed) {
        for (const t of suite.tests) {
          const m = t.ok ? C.green('·') : C.red('×');
          console.log(`   ${m} ${t.title}${t.ms > 5 ? C.dim(` (${t.ms} ms)`) : ''}`);
          if (!t.ok) console.log(`     ${C.red(t.error)}`);
        }
      }
    }
    const verdict = report.failed === 0 ? C.green(`${report.passed}/${report.total} tests réussis`) : C.red(`${report.failed} échec(s) sur ${report.total}`);
    console.log(`\n${verdict} ${C.dim(`en ${report.duration_ms} ms`)}`);
  }
  process.exit(report.failed === 0 ? 0 : 1);
}

async function cmdStatus() {
  const { COMPONENT_STATUS, statusSummary, PHASE } = await load('../status.ts');
  const summary = statusSummary();
  if (has('json')) {
    console.log(JSON.stringify({ summary, components: COMPONENT_STATUS }, null, 2));
    return;
  }
  console.log(`\n${C.bold('Ciel')} — phase ${PHASE}, ${summary.total} composants`);
  for (const [status, count] of Object.entries(summary.counts)) {
    const color = status === 'TESTED_IN_BASE44' || status === 'IMPLEMENTED' ? C.green : status === 'REQUIRES_EXTERNAL_RUNTIME' ? C.yellow : C.dim;
    console.log(`  ${color(status.padEnd(26))} ${count}`);
  }
  console.log('');
}

async function cmdRun() {
  const source = positional[0];
  if (!source) {
    console.error('Usage : ciel.mjs run <plan.json|-> [--json]');
    process.exit(2);
  }
  const plan = await readPlan(source);
  const { createCiel } = await load('../runtime.ts');
  const { createInMemoryStore } = await load('../adapters/memory/inMemoryStore.ts');
  const { createWorld } = await load('../capabilities/world.ts');
  const { createConfig } = await load('../core/config.ts');

  const ciel = createCiel({
    store: createInMemoryStore(),
    config: createConfig(),
    permissions: ['state:write', 'email:send'],
    world: createWorld({}),
    withReferenceCapabilities: true,
  });
  const report = await ciel.run(plan);

  if (has('json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n${C.bold('statut')}      ${report.status}`);
    if (report.outcome) console.log(`${C.bold('mission')}     ${report.outcome}`);
    if (report.reason) console.log(`${C.bold('raison')}      ${report.reason}`);
    if (report.verification) {
      const v = report.verification;
      console.log(`${C.bold('vérifié')}     ${v.verified} vérifiée(s), ${v.unverified} non vérifiée(s), ${v.failed} échec(s)`);
    }
    if (report.ledger) console.log(`${C.bold('journal')}     ${report.ledger.count} événement(s), chaîne ${report.ledger.chain_ok ? C.green('intacte') : C.red('rompue')}`);
    if (report.reframe) console.log(`${C.bold('repli')}       ${report.reframe.source} — ${report.reframe.reason}`);
    console.log('');
  }
  process.exit(report.status === 'EXECUTED' ? 0 : 1);
}

function flagValue(name, fallback = null) {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}

async function cmdServe() {
  const { createCielServer, listen } = await load('../server/main.ts');
  const port = Number(flagValue('port', 8787));
  const dataDir = flagValue('data');
  const allowAnon = has('allow-anon');
  const token = process.env.CIEL_TOKEN || (allowAnon ? null : randomBytes(24).toString('hex'));

  // Durable persistence is opt-in: without --data the process keeps state in memory only.
  let store = null;
  if (dataDir) {
    const { createFileStore } = await load('../adapters/fs/fileStore.ts');
    store = await createFileStore({ dir: dataDir });
  }

  const server = createCielServer({ token, allowAnon, cors: has('cors'), store });
  const listener = await listen(server, { port, host: process.env.CIEL_HOST || '0.0.0.0' });

  console.log(`\n${C.bold('Ciel')} — ${listener.runtime} sur ${C.cyan(listener.url)}`);
  console.log(`  ${C.dim('GET ')}/health  /status  /capabilities  /missions`);
  console.log(`  ${C.dim('POST')} /run  { "intent": "..." }  ou  { "plan": {...} }`);
  console.log(`  ${C.dim('POST')} /resume  { "mission_id": "..." }`);
  console.log(`\n  ${C.dim('état')} ${dataDir ? `durable (${dataDir})` : 'en mémoire (perdu au redémarrage) — utilisez --data <dir>'}`);
  if (token) console.log(`\n  ${C.yellow('token')} ${token}\n  ${C.dim('en-tête : Authorization: Bearer <token>')}`);
  else console.log(`\n  ${C.yellow('aucun token (--allow-anon) : ne pas exposer au-delà de localhost')}\n`);
}

function cmdHelp() {
  console.log(`
${C.bold('ciel')} — noyau cognitif portable, hors Base44

  ${C.bold('test')}    [--json] [--verbose]   exécute les suites A→I
  ${C.bold('status')}  [--json]               registre d'honnêteté des composants
  ${C.bold('run')}     <plan.json|->          exécute un plan structuré
  ${C.bold('serve')}   [--port 8787] [--data <dir>] [--allow-anon] [--cors]
  ${C.bold('help')}

Lancement (Node 22.18+ sait importer du .ts directement) :
  node --experimental-strip-types ciel-core/bin/ciel.mjs test
  bun ciel-core/bin/ciel.mjs test
  deno run --allow-net --allow-env ciel-core/bin/ciel.mjs test
`);
}

switch (command) {
  case 'test': await cmdTest(); break;
  case 'status': await cmdStatus(); break;
  case 'run': await cmdRun(); break;
  case 'serve': await cmdServe(); break;
  case 'help': case '--help': case '-h': cmdHelp(); break;
  default:
    console.error(`Commande inconnue : ${command}`);
    cmdHelp();
    process.exit(2);
}
