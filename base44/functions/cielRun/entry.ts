// Runs a mission from the console: intention (or structured plan) -> verified outcome.
// This is the platform surface over ciel-core/orchestrator.ts; it contains no logic of its own.
//
// Persistence: missions, tasks, the ledger, checkpoints and pending proposals go to the
// CielRecord entity, so a proposal survives between two HTTP calls (that is what makes the
// confirmation flow work). The `world` the capabilities act on is rebuilt per call: it is a
// simulation, and claiming otherwise would be a lie about what runs.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { createBase44EntityStore } from '../../../ciel-core/adapters/base44/entityStore.ts';
import { createCiel } from '../../../ciel-core/runtime.ts';
import { createWorld } from '../../../ciel-core/capabilities/world.ts';
import { SystemClock } from '../../../ciel-core/core/clock.ts';

// Only what is needed for the reference capabilities. Irreversible capabilities (mail.send)
// are deliberately NOT granted here.
const PERMISSIONS = ['state:write'];
const NAMESPACE = 'ciel_';

const MAX_INTENT_LENGTH = 4000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const input = typeof body.intent === 'string' ? body.intent.trim() : (body.plan ?? null);
    const confirm = typeof body.confirm === 'string' ? body.confirm : null;

    if (!input && !confirm) {
      return Response.json({ error: 'send { intent } or { plan }, or { confirm: proposal_id }' }, { status: 400 });
    }
    if (typeof input === 'string' && input.length > MAX_INTENT_LENGTH) {
      return Response.json({ error: `intent is limited to ${MAX_INTENT_LENGTH} characters` }, { status: 413 });
    }

    const store = createBase44EntityStore({ entity: base44.asServiceRole.entities.CielRecord, namespace: NAMESPACE });
    const world = createWorld({});

    const ciel = createCiel({
      store, clock: SystemClock, permissions: PERMISSIONS, world, withReferenceCapabilities: true,
    });

    const report = await ciel.run(input, { confirm });

    // Never return the whole store: only what the report needs.
    return Response.json({
      status: report.status,
      reason: report.reason ?? null,
      errors: report.errors ?? [],
      intake: report.intake ? { kind: report.intake.kind, executable: report.intake.executable, reason: report.intake.reason } : null,
      plan: report.plan ?? null,
      provenance: report.provenance ?? null,
      confirmation: report.confirmation ?? null,
      sufficiency: report.sufficiency ?? null,
      mission: report.mission ? { id: report.mission.id, goal: report.mission.goal, status: report.mission.status } : null,
      outcome: report.outcome ?? null,
      verification: report.verification ?? null,
      ledger: report.ledger ?? null,
      reframe: report.reframe ?? null,
      steps: report.steps ?? [],
      ai_calls: report.ai_calls,
    });
  } catch (error) {
    return Response.json({ error: error.message, code: error.code ?? null }, { status: 500 });
  }
}
