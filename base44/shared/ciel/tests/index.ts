// Registers every Phase A suite and exposes a single entry point.
// Import order defines suite order in the report.
import './phaseA/mission.test.ts';
import './phaseA/plan.test.ts';
import './phaseA/knowledge.test.ts';
import './phaseA/decision.test.ts';
import './phaseA/ledger.test.ts';
import './phaseA/budget.test.ts';
import './phaseA/independence.test.ts';
import { runAll } from './runner.ts';

export { runAll };