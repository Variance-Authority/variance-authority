import { appendFileSync } from 'node:fs';

// Writes the title of every Playwright API step a test shows, one per line, to
// the file `VARIANCE_AUTHORITY_STEPS` names — what a user sees of a run in the
// HTML report, the trace viewer and the inspector.
export default class StepsReporter {
  onStepBegin(_test, _result, step) {
    if (step.category === 'pw:api') appendFileSync(process.env['VARIANCE_AUTHORITY_STEPS'], `${step.title}\n`);
  }
}
