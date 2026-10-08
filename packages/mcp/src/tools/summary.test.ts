import { describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { toolByName } from '../tools.js';

/** A run where three subjects share one reason and a fourth has its own. */
const because = 'the baseline and this run were painted on the same machine under different recipes';

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: {
    renderer: 'playwright-chromium',
    engine: 'chromium@131.0.0',
    platform: 'darwin/arm64',
    deviceScaleFactor: 1,
    fonts: [],
  },
  retention: 'durable',
  observations: [
    ...['a', 'b', 'c'].map((name) => ({
      subject: `page/${name}`,
      verdict: 'incomparable' as const,
      because,
      changedPixels: 0,
      regions: [],
    })),
    {
      subject: 'page/alone',
      verdict: 'incomparable',
      because: 'a baseline exists under another machine',
      changedPixels: 0,
      regions: [],
    },
  ],
};

describe('the summary', () => {
  it('states a reason many subjects share once, with a count, and still names each subject', () => {
    // An upgrade that moves the identity key makes every subject incomparable
    // for one reason. Printed per subject, a 4,705-subject run said the same
    // two-identity sentence 4,697 times, and a reader looking for what to do
    // had to notice it was one sentence. Said once, the count and the remedy
    // are the first thing under the verdict counts.
    const text = toolByName('variance_summary')!.run(REPORT, {}) as string;

    expect(text.split(because).length - 1).toBe(1);
    expect(text).toContain(`[incomparable] 3 subjects: ${because}`);
    for (const name of ['a', 'b', 'c']) expect(text).toContain(`    page/${name}`);
    // A reason only one subject has stays on that subject's line.
    expect(text).toContain('[incomparable] page/alone: a baseline exists under another machine');
  });
});
