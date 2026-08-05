import { describe, expect, it } from 'vitest';
import { ledgerOf, liveIgnores, summarizeLedger } from './ignores.js';
import type { IgnoreConfig } from '../config.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The register, which is what makes an ignore safe to have at all.
 *
 * A masked region nobody can see is worse than a red suite, so every assertion
 * here is about *visibility* rather than about absorption: a rule that caught
 * nothing has to be named, a rule that resolved nowhere has to be named
 * differently, and a run whose subjects went green because nobody looked has to
 * say how many.
 */

const CLOCK: IgnoreConfig = { id: 'clock', reason: 'wall time', select: 'time' };
const CAROUSEL: IgnoreConfig = { id: 'carousel', reason: 'rotates', select: '.carousel' };

function observation(
  subject: string,
  verdict: CliObservationRecord['verdict'],
  ignored?: CliObservationRecord['ignored'],
): CliObservationRecord {
  return {
    subject,
    verdict,
    because: 'because',
    changedPixels: 0,
    regions: [],
    ...(ignored !== undefined ? { ignored } : {}),
  };
}

describe('a rule that is doing its job', () => {
  const report = [
    observation('a', 'ignored', { pixels: 40, boxes: 1, inert: 0, byRule: { clock: 40 } }),
    observation('b', 'ignored', { pixels: 12, boxes: 1, inert: 0, byRule: { clock: 12 } }),
  ];

  it('totals what it absorbed and where', () => {
    const ledger = ledgerOf([CLOCK], report)!;

    expect(ledger.rules[0]).toMatchObject({ rule: 'clock', pixels: 52, subjects: 2 });
    expect(ledger.dead).toEqual([]);
  });

  it('names the subjects that went green because nobody looked', () => {
    expect(ledgerOf([CLOCK], report)!.fullyIgnored).toEqual(['a', 'b']);
  });
});

describe('a rule that has stopped earning its place', () => {
  it('is named when it resolved somewhere and absorbed nothing', () => {
    const ledger = ledgerOf(
      [CLOCK],
      [observation('a', 'unchanged', { pixels: 0, boxes: 1, inert: 1, byRule: { clock: 0 } })],
    )!;

    expect(ledger.dead).toEqual(['clock']);
    expect(summarizeLedger(ledger).join('\n')).toContain('absorbed nothing');
  });

  it('is not called dead on a run that compared nothing', () => {
    // A fresh checkout with no baselines: every subject is `new`, so no ignore
    // could absorb anything. Reporting them all dead told the operator to delete
    // the config on the one run that proves least about it.
    const ledger = ledgerOf(
      [CLOCK],
      [observation('a', 'new', { pixels: 0, boxes: 1, inert: 0, byRule: { clock: 0 } })],
    )!;

    expect(ledger.dead).toEqual([]);
    expect(ledger.rules[0]).toMatchObject({ subjects: 1, comparedIn: 0, unresolved: false });
    expect(summarizeLedger(ledger).join('\n')).toContain('none of which was compared');
  });

  it('is still called dead when it was compared and took nothing', () => {
    // The control. A denominator that never let anything be dead would remove
    // the only line that ever asks an operator to delete an ignore.
    const ledger = ledgerOf(
      [CLOCK],
      [
        observation('a', 'new', { pixels: 0, boxes: 1, inert: 0, byRule: { clock: 0 } }),
        observation('b', 'changed', { pixels: 0, boxes: 1, inert: 1, byRule: { clock: 0 } }),
      ],
    )!;

    expect(ledger.dead).toEqual(['clock']);
    expect(ledger.rules[0]).toMatchObject({ subjects: 2, comparedIn: 1 });
  });

  it('is named differently when it resolved nowhere at all', () => {
    // Two different problems. "Excluded a subtree and caught nothing" is probably
    // a fixed flake; "matched nothing anywhere" is probably a selector that has
    // rotted, and something the operator believes is silenced is being reported.
    const ledger = ledgerOf([CAROUSEL], [observation('a', 'unchanged')])!;

    expect(ledger.dead).toEqual(['carousel']);
    expect(summarizeLedger(ledger).join('\n')).toContain('matched nothing in any subject');
  });

  it('is not called dead when it is merely expired', () => {
    const expired: IgnoreConfig = { ...CLOCK, until: '2026-01-01' };
    const ledger = ledgerOf([expired], [observation('a', 'unchanged')], '2026-08-05')!;

    expect(ledger.dead).toEqual([]);
    expect(summarizeLedger(ledger).join('\n')).toContain('[expired] clock');
  });
});

describe('what reaches the collector', () => {
  it('drops an expired rule, so what it absorbed is reported again', () => {
    const expired: IgnoreConfig = { ...CLOCK, until: '2026-01-01' };

    expect(liveIgnores([expired, CAROUSEL], '2026-08-05')).toEqual([CAROUSEL]);
  });

  it('keeps a rule on the day it expires', () => {
    // `until` is the last day it holds, not the first day it does not. The other
    // reading is defensible and this one has to be pinned, because a suite that
    // goes red a day early looks like a regression.
    const expiring: IgnoreConfig = { ...CLOCK, until: '2026-08-05' };

    expect(liveIgnores([expiring], '2026-08-05')).toEqual([expiring]);
  });

  it('keeps it all day, given the timestamp a run actually passes', () => {
    // The clock is `deps.now()`, which is a full ISO instant — never the bare
    // date every test here used to send. Comparing instants expired the rule at
    // one millisecond past midnight *on* its own day, so the documented "last day
    // it holds" was true of the tests and false of the binary.
    const expiring: IgnoreConfig = { ...CLOCK, until: '2026-08-05' };

    expect(liveIgnores([expiring], '2026-08-05T00:00:00.001Z')).toEqual([expiring]);
    expect(liveIgnores([expiring], '2026-08-05T23:59:59.999Z')).toEqual([expiring]);
    expect(liveIgnores([expiring], '2026-08-06T00:00:00.000Z')).toEqual([]);
  });
});

describe('a tag nothing wears', () => {
  const VOLATILE: IgnoreConfig = {
    id: 'live',
    reason: 'ticks',
    select: '.feed',
    tags: ['volatle'],
  };

  it('is named, because a misspelled tag is a legal word that matches nothing', () => {
    // The one thing a closed key list cannot catch. `tags: ['volatle']` parses,
    // validates, applies nowhere, and the operator reads their config and
    // believes it applies somewhere.
    const ledger = ledgerOf([VOLATILE], [observation('a', 'unchanged')], undefined, ['volatile'])!;

    expect(ledger.rules[0]!.unwornTags).toEqual(['volatle']);
    expect(summarizeLedger(ledger).join('\n')).toContain('[unworn] live');
  });

  it('names the tag that is worn, when it is one edit away', () => {
    const ledger = ledgerOf([VOLATILE], [observation('a', 'unchanged')], undefined, ['volatile'])!;

    expect(summarizeLedger(ledger).join('\n')).toContain('did you mean `volatile`?');
  });

  it('says nothing when the tag is worn', () => {
    // The control. An audit that fires on a correct config is one nobody reads.
    const ledger = ledgerOf(
      [{ ...VOLATILE, tags: ['volatile'] }],
      [observation('a', 'unchanged')],
      undefined,
      ['volatile'],
    )!;

    expect(ledger.rules[0]!.unwornTags).toEqual([]);
    expect(summarizeLedger(ledger).join('\n')).not.toContain('[unworn]');
  });

  it('says nothing when the run declared no vocabulary at all', () => {
    // A route plan reads no artifact that declares tags. Judging a rule against
    // an empty vocabulary would report every tag as unworn on every such suite,
    // which is an audit that fires exactly where it cannot see.
    const ledger = ledgerOf([VOLATILE], [observation('a', 'unchanged')])!;

    expect(ledger.rules[0]!.unwornTags).toEqual([]);
  });
});

describe('a run with no ignores', () => {
  it('has no ledger and prints nothing', () => {
    expect(ledgerOf([], [observation('a', 'unchanged')])).toBeUndefined();
    expect(summarizeLedger(undefined)).toEqual([]);
  });
});

describe('a marker in somebody else’s markup', () => {
  it('is counted on the subject and is not invented into a config rule', () => {
    // `data-variance-ignore` needs no config entry. It is a real declaration and
    // the subject records it; what it must not do is appear in a ledger of rules
    // the operator wrote, where an id nobody can find would read as a typo.
    const ledger = ledgerOf(
      [CLOCK],
      [observation('a', 'ignored', { pixels: 9, boxes: 1, inert: 0, byRule: { marked: 9 } })],
    )!;

    expect(ledger.rules.map((entry) => entry.rule)).toEqual(['clock']);
    expect(ledger.rules[0]!.pixels).toBe(0);
  });
});
