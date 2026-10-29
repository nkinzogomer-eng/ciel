// Runs the Ciel Core test suite and returns the component status registry.
// The Core is portable: this function is only a *surface* over it. The same suite runs
// unchanged under Deno/Node outside Base44 (see ciel-core/bin/ciel.mjs).
//
// Access: admins only. The suite is cheap (milliseconds) but it is still work an anonymous
// caller could trigger in a loop, and it returns the full component registry.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { runAll } from '../../../ciel-core/tests/index.ts';
import { COMPONENT_STATUS, NOT_CLAIMED, statusSummary, PHASE } from '../../../ciel-core/status.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const results = await runAll();
    return Response.json({
      phase: PHASE,
      ai_enabled: false,
      results,
      status_summary: statusSummary(),
      components: COMPONENT_STATUS,
      not_claimed: NOT_CLAIMED,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
