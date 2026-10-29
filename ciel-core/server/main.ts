// Standalone Ciel server — a surface that owes nothing to Base44.
//
// It is written against the WHATWG Fetch API only: `fetch(Request) -> Response`. That object
// runs unchanged on Bun and Deno, and `listen()` adds a thin Node adapter for `node:http`.
// No framework, no dependency, no build step.
//
// Routes
//   GET  /health        liveness + version + degradation level
//   GET  /status        the honesty registry (what is implemented, what is not)
//   GET  /capabilities  the registered capabilities, with their manifest
//   GET  /components    the component status table, flat
//   POST /run           { intent? , plan? , confirm? , limits? , confirmations? , humanAnswers? }
//   POST /resume        { mission_id }
//   GET  /missions      the missions that ran in this process
//   GET  /missions/:id  mission + tasks + ledger summary
//
// Security: every route except /health requires `Authorization: Bearer <token>` when a token
// is configured. The CLI refuses to start without one unless --allow-anon is passed, so a
// server accidentally exposed on a network is not an open door.
//
// State: in-memory by default, per process. Persistence is a deliberate injection
// (`store`), exactly like everywhere else in Ciel.
import { createCiel } from '../runtime.ts';
import { createInMemoryStore } from '../adapters/memory/inMemoryStore.ts';
import { createWorld } from '../capabilities/world.ts';
import { createConfig } from '../core/config.ts';
import { SystemClock } from '../core/clock.ts';
import { COMPONENT_STATUS, statusSummary, PHASE } from '../status.ts';
import { CIEL_VERSION } from '../core/version.ts';
import { RunStatus } from '../orchestrator.ts';

const MAX_BODY_BYTES = 256 * 1024;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
});

const nowMs = () => Date.now();

export function createCielServer({
  token = null,
  allowAnon = false,
  cors = false,
  permissions = ['state:write', 'email:send'],
  ai = { enabled: false },
  provider = null,
  store = null,
  withReferenceCapabilities = true,
} = {}) {
  if (!token && !allowAnon) {
    throw new Error('refusing to start without a token: pass { token } or { allowAnon: true }');
  }

  const runtimeStore = store ?? createInMemoryStore();
  const world = createWorld({});
  const ciel = createCiel({
    store: runtimeStore,
    clock: SystemClock,
    config: createConfig({ ai }),
    provider,
    providerAvailable: provider ? true : false,
    permissions,
    world,
    withReferenceCapabilities,
  });
  const startedAt = nowMs();

  function authorized(req) {
    if (!token) return true;
    const header = req.headers.get('authorization') || '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    return presented === token;
  }

  function preflight() {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      },
    });
  }

  async function readJson(req) {
    const raw = await req.text();
    if (!raw) return {};
    if (raw.length > MAX_BODY_BYTES) {
      const err = new Error(`request body larger than ${MAX_BODY_BYTES} bytes`);
      err.status = 413;
      throw err;
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      const err = new Error('request body is not valid JSON');
      err.status = 400;
      throw err;
    }
  }

  async function route(req, url) {
    const { pathname } = url;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') return preflight();

    if (pathname === '/health' && method === 'GET') {
      return json({
        ok: true, version: CIEL_VERSION, phase: PHASE,
        ai_enabled: ciel.ai_enabled, degradation: ciel.degradation,
        uptime_ms: nowMs() - startedAt,
      });
    }

    if (!authorized(req)) {
      return json({ error: 'unauthorized', hint: 'send Authorization: Bearer <token>' }, 401);
    }

    if (pathname === '/status' && method === 'GET') {
      return json({ phase: PHASE, version: CIEL_VERSION, summary: statusSummary(), components: COMPONENT_STATUS });
    }

    if (pathname === '/capabilities' && method === 'GET') {
      return json({ capabilities: ciel.registry.list() });
    }

    if (pathname === '/components' && method === 'GET') {
      return json({ components: COMPONENT_STATUS });
    }

    if (pathname === '/missions' && method === 'GET') {
      const missions = await runtimeStore.find('missions', {});
      return json({
        count: missions.length,
        missions: missions.map((m) => ({ id: m.id, goal: m.goal, status: m.status, created_at: m.created_at })),
      });
    }

    if (pathname.startsWith('/missions/') && method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/missions/'.length));
      const mission = await runtimeStore.get('missions', id);
      if (!mission) return json({ error: 'not found', mission_id: id }, 404);
      const tasks = await runtimeStore.find('tasks', { mission_id: id });
      const chain = await ciel.ledger.verify(id);
      const summary = await ciel.ledger.summary(id);
      return json({ mission, tasks, ledger: { ...summary, chain_ok: chain.ok, chain_reason: chain.reason } });
    }

    if (pathname === '/run' && method === 'POST') {
      const body = await readJson(req);
      // Accept the three natural shapes: { plan }, { intent }, or a bare plan ({ goal, tasks }).
      // A confirmation carries no input at all: it names a proposal that is already stored.
      const input = body.plan ?? body.intent ?? body.input ?? (Array.isArray(body.tasks) ? body : null);
      const confirm = body.confirm ?? null;
      if (input === null && !confirm) {
        return json({ error: 'send "intent", "plan", a bare plan, or "confirm": "<proposal_id>"' }, 400);
      }
      const report = await ciel.run(input, {
        confirm,
        limits: body.limits ?? null,
        confirmations: body.confirmations ?? {},
        humanAnswers: body.humanAnswers ?? {},
        maxSteps: body.maxSteps ?? 50,
      });
      // 200 for anything Ciel answered; the body says what actually happened.
      return json(report);
    }

    if (pathname === '/resume' && method === 'POST') {
      const body = await readJson(req);
      if (!body.mission_id) return json({ error: '"mission_id" is required' }, 400);
      const result = await ciel.resume(body.mission_id, {
        confirmations: body.confirmations ?? {},
        humanAnswers: body.humanAnswers ?? {},
      });
      return json(result);
    }

    return json({ error: 'not found', path: pathname }, 404);
  }

  async function fetch(request) {
    const url = new URL(request.url);
    try {
      const response = await route(request, url);
      if (!cors) return response;
      const headers = new Headers(response.headers);
      headers.set('access-control-allow-origin', '*');
      return new Response(response.body, { status: response.status, headers });
    } catch (e) {
      const status = e.status && Number.isInteger(e.status) ? e.status : 500;
      return json({ error: e.message, code: e.code ?? null }, status);
    }
  }

  return {
    fetch, ciel, store: runtimeStore,
    // Reports are plain JSON; this exists so a caller can tell an accepted run from a refused one.
    statuses: RunStatus,
  };
}

// ---------------------------------------------------------------------------
// listen(): one function, three runtimes.
// ---------------------------------------------------------------------------
export async function listen(server, { port = 8787, host = '0.0.0.0' } = {}) {
  if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
    const listener = Deno.serve({ port, hostname: host }, server.fetch);
    return { runtime: 'deno', url: `http://${host}:${port}`, close: () => listener.shutdown() };
  }
  if (typeof Bun !== 'undefined' && typeof Bun.serve === 'function') {
    const listener = Bun.serve({ port, hostname: host, fetch: server.fetch });
    return { runtime: 'bun', url: `http://${host}:${listener.port}`, close: () => listener.stop(true) };
  }
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const http = await import('node:http');
    const nodeServer = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://${req.headers.host || `${host}:${port}`}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: body && body.length ? body : undefined,
      });
      const response = await server.fetch(request);
      const out = Buffer.from(await response.arrayBuffer());
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(response.status, headers);
      res.end(out);
    });
    await new Promise((resolve, reject) => {
      nodeServer.once('error', reject);
      nodeServer.listen(port, host, resolve);
    });
    return { runtime: 'node', url: `http://${host}:${port}`, close: () => nodeServer.close() };
  }
  throw new Error('no supported runtime found for listen() (Deno, Bun or Node >= 18)');
}
