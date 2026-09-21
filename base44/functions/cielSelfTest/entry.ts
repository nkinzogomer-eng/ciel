// Runs the Ciel Core test suite and returns the component status registry.
// The Core is portable: this function is only a *surface* over it. The same suite runs
// unchanged under Deno/Node outside Base44.
import { runAll } from '../../shared/ciel/tests/index.ts';
import { COMPONENT_STATUS, statusSummary, PHASE } from '../../shared/ciel/status.ts';

export default async function (req) {
  try {
    const results = await runAll();
    return Response.json({
      phase: PHASE,
      ai_enabled: false,
      results,
      status_summary: statusSummary(),
      components: COMPONENT_STATUS,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}