import { describe, expect, it } from 'vitest';
import {
  collectorOf,
  configOf,
  documentFor,
  runWith,
  storeAnswering,
} from './run-fixture.js';
import type { Plan } from './run.js';

/**
 * The run's one report about subjects it did not look at (ADR-0063).
 *
 * Advisory by construction: the sentence is a warning, the exit code does not
 * move, and a store that cannot answer produces prose rather than a lost run.
 * `unplanned.ts` holds why it is asked of the whole plan; these hold what the
 * run does with each of the three answers a store can give.
 */

const PLAN: Plan = {
  subjects: [
    { subject: { id: 'fixture:a', kind: 'fixture' } },
    { subject: { id: 'fixture:b', kind: 'fixture' } },
  ],
  notObserved: [],
  warnings: [],
};

const collectsBoth = collectorOf(PLAN, (subject) => ({
  ok: true,
  document: documentFor(subject.subject.id),
}));

describe('unplanned subjects', () => {
// A discovered plan reports an addition loudly and a removal not at all: the
// dropped subject is never collected, so no verdict names it, while its
// approved image stays on disk. The store is the only thing that can notice.
it('names an approved subject the plan no longer contains', async () => {
  const { report } = await runWith(configOf(), collectsBoth, {
    ...storeAnswering(null),
    async unplanned() {
      return ['fixture:gone'];
    },
  });

  expect(report.warnings?.join('\n')).toContain('fixture:gone');
});

// `unplanned` is optional because a backend behind an API with no list call
// cannot answer it, and a run that turned that into a sentence would report
// every store that cannot enumerate as a store holding nothing.
it('says nothing about held subjects when the store cannot enumerate', async () => {
  const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null));

  expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
});

// Advisory, and asked after every planned subject has already been compared.
// A directory that could not be listed is not a reason to lose the run.
it('reports a store that could not be asked, rather than ending the run', async () => {
  const { report } = await runWith(configOf(), collectsBoth, {
    ...storeAnswering(null),
    async unplanned() {
      throw new Error('EACCES');
    },
  });

  expect(report.observations).toHaveLength(2);
  expect(report.warnings?.join('\n')).toContain('could not be asked what it holds');
});
});
