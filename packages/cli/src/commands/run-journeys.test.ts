import { describe, expect, it } from 'vitest';
import type { Collector, Plan } from './run.js';
import { collectorOf, configOf, documentFor, runWith, storeAnswering } from './run-fixture.js';

/**
 * The run and the journal: which subjects it names, what it carries back, and
 * the order that makes the answer this run's rather than the last one's.
 */
describe('run, where its subjects parted', () => {
  const plan: Plan = {
    subjects: [
      { subject: { id: 'fixture:a', kind: 'fixture' } },
      { subject: { id: 'fixture:b', kind: 'fixture' } },
    ],
    notObserved: [{ subject: 'fixture:x', kind: 'excluded', because: 'tagged `!test`' }],
    warnings: [],
  };

  const collectsBoth = collectorOf(plan, (subject) => ({
    ok: true,
    document: documentFor(subject.subject.id),
  }));

  it("asks the journal where this run's own subjects parted, and carries the answer as it came", async () => {
    const recorded = { commit: '4f2a1c9d0b73', whole: ['fixture:a'], truncated: [], unrecorded: ['fixture:b'], found: [] };
    const asked: string[][] = [];

    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null), {
      readJourneys: async (subjects) => {
        asked.push([...subjects]);
        return { at: '/cache/journal', recorded };
      },
    });

    expect(asked).toEqual([['fixture:a', 'fixture:b', 'fixture:x']]);
    expect(report.journeys).toEqual(recorded);
  });

  it('closes the collector before it asks where the subjects parted', async () => {
    // A Storybook collector writes the journal as it closes. Asked first, the
    // report would carry the run before this one — and nothing on the first.
    let closed = false;
    let closedWhenAsked: boolean | undefined;
    const collector: Collector = {
      ...collectsBoth,
      async close() {
        closed = true;
      },
    };

    await runWith(configOf(), collector, storeAnswering(null), {
      readJourneys: async () => {
        closedWhenAsked = closed;
        return { at: '/cache/journal' };
      },
    });

    expect(closedWhenAsked).toBe(true);
  });

  it('carries no journeys section at all when there is no journal', async () => {
    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null), {
      readJourneys: async () => ({ at: '/cache/journal' }),
    });

    expect(report).not.toHaveProperty('journeys');
  });
});
