// Registers every Phase A suite and exposes a single entry point.
// Import order defines suite order in the report.
import './phaseA/mission.test.ts';
import './phaseA/plan.test.ts';
import './phaseA/knowledge.test.ts';
import './phaseA/decision.test.ts';
import './phaseA/ledger.test.ts';
import './phaseA/budget.test.ts';
import './phaseA/independence.test.ts';
import './phaseB/persistence.test.ts';
import './phaseB/fileStore.test.ts';
import './phaseC/execution.test.ts';
import './phaseC/goalKernel.test.ts';
import './phaseD/verification.test.ts';
import './phaseE/invalidation.test.ts';
import './phaseF/budgetLoop.test.ts';
import './phaseG/learning.test.ts';
import './phaseH/intelligence.test.ts';
import './phaseI/orchestrator.test.ts';
import { runAll } from './runner.ts';

export { runAll };