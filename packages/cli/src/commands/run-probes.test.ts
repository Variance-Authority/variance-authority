import { describe, expect, it } from 'vitest';
import type { SourceIndex } from '@variance-authority/core/attribute';
import type { Collected, Plan } from './run.js';
import { collectorOf, configOf, documentFor, runWith, storeAnswering, whiteBaselineOf } from './run-fixture.js';

/**
 * A run narrowed by a journal cut under probes this build does not place is
 * narrowed by it as it holds it, and the run says the gap beside the narrowing.
 */

const SOURCE: SourceIndex = { Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }] };

const TWO: Plan = {
  subjects: [
    { subject: { id: 'fixture:a', kind: 'fixture' } },
    { subject: { id: 'fixture:b', kind: 'fixture' } },
  ],
  notObserved: [],
  warnings: [],
};

const BOTH = collectorOf(TWO, (subject): Collected => ({ ok: true, document: documentFor(subject.subject.id) }));

const DIFF = ['--- a/src/Button.tsx', '+++ b/src/Button.tsx', '@@ -9,1 +9,1 @@'].join('\n');

function stored() {
  const baseline = whiteBaselineOf(documentFor('fixture:a'));
  return storeAnswering({
    ...baseline,
    raster: { ...baseline.raster, components: [{ component: 'Button', instances: 1, structure: 'v1:s' }] },
  });
}

describe('a run narrowed by a journal cut under other probes', () => {
  it('says the journal\'s probes gap beside the narrowing it read from that journal', async () => {
    const probes = '`journal.bin` was cut under the probes `sense:instrument/presence-v5`, and this build places another';

    const { report } = await runWith(configOf({ source: { dirs: ['src'] } }), BOTH, stored(), {
      since: { ref: 'origin/main', changed: ['src/Button.tsx'], diff: DIFF },
      scanSource: async () => SOURCE,
      readJourney: async () => ({ whole: ['fixture:a', 'fixture:b'], entered: ['fixture:a'], unread: [], because: [], probes }),
    });

    expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(report.warnings).toContain(probes);
  });
});
