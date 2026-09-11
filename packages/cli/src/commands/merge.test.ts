import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import { OperatorError, exitFor } from '../exit.js';
import { mergeReports, type Shard } from './merge.js';
import { shardFilterBecause, type CliRunReport } from './run-report.js';

/**
 * Merging is all string and set work, so every case here is a plain value — no
 * browser, no filesystem, no clock. That is the point of the command being a
 * function: the questions worth asking about a sharded suite are questions about
 * arithmetic on coverage lists, and they get asked in milliseconds.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

const GLOB = 'story:a*';

function observation(subject: string, verdict: 'unchanged' | 'changed' = 'unchanged') {
  return {
    subject,
    verdict,
    because: verdict === 'unchanged' ? 'nothing moved' : '12 pixel(s) differ',
    ...(verdict === 'changed' ? { changedPixels: 12 } : {}),
    regions: [],
  };
}

function report(over: Partial<CliRunReport> = {}): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-04T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: [],
    notObserved: [],
    ...over,
  };
}

function shard(path: string, over: Partial<CliRunReport> = {}): Shard {
  return { path, report: report(over) };
}

/** The shape a three-way split actually produces: one observed, two filtered. */
function split(): readonly Shard[] {
  return [
    shard('shard-1.json', {
      observations: [observation('story:a')],
      notObserved: [
        { subject: 'story:b', kind: 'excluded', because: shardFilterBecause('story:b*') },
        { subject: 'story:c', kind: 'excluded', because: shardFilterBecause('story:c*') },
      ],
    }),
    shard('shard-2.json', {
      at: '2026-08-04T10:05:00.000Z',
      observations: [observation('story:b', 'changed')],
      notObserved: [
        { subject: 'story:a', kind: 'excluded', because: shardFilterBecause(GLOB) },
        { subject: 'story:c', kind: 'excluded', because: shardFilterBecause('story:c*') },
      ],
    }),
    shard('shard-3.json', {
      observations: [observation('story:c')],
      notObserved: [
        { subject: 'story:a', kind: 'excluded', because: shardFilterBecause(GLOB) },
        { subject: 'story:b', kind: 'excluded', because: shardFilterBecause('story:b*') },
      ],
    }),
  ];
}

describe('a sharded suite becomes one report', () => {
  it('keeps every observation, in shard order', () => {
    expect(mergeReports(split()).observations.map((entry) => entry.subject)).toEqual([
      'story:a',
      'story:b',
      'story:c',
    ]);
  });

  it('drops a filter for a subject another shard observed', () => {
    // The whole reason the naive concatenation is wrong: three shards report the
    // same three subjects as excluded six times between them, and every one of
    // those exclusions is about a subject that was in fact looked at.
    expect(mergeReports(split()).notObserved).toEqual([]);
  });

  it('reports the oldest shard as the run time', () => {
    expect(mergeReports(split()).at).toBe('2026-08-04T10:00:00.000Z');
  });

  it('carries a change through, so the merged run needs review', () => {
    expect(exitFor(mergeReports(split()))).toBe(1);
  });

  it('is the identity function on one report', () => {
    const only = shard('one.json', { observations: [observation('story:a')] });
    expect(mergeReports([only])).toBe(only.report);
  });
});

describe('the one section a split destroys', () => {
  const composed = (): readonly Shard[] => [
    shard('one.json', {
      observations: [observation('story:a')],
      composition: {
        subjects: ['story:a'],
        components: [
          {
            component: 'Button',
            subjects: ['story:a'],
            instances: 1,
            examples: ['story:a'],
            within: [],
            createdBy: [],
            renders: [],
            tokens: [],
            variants: 1,
            renderings: 1,
          },
        ],
        echoes: [],
        divergences: [],
        movements: [],
      },
    }),
    shard('two.json', { observations: [observation('story:b')] }),
  ];

  it('drops the composition rather than unioning two partial graphs', () => {
    // A union would be a graph with every cross-shard edge missing and nothing
    // marking where. Two subjects sharing a rendering are the finding, and a
    // pair split across shards is in neither report — so the echo count would be
    // silently a lower bound and the `held` list silently short, which is the
    // evidence behind calling something a flake.
    expect(mergeReports(composed()).composition).toBeUndefined();
  });

  it('says it dropped it, because a missing section reads as an answer', () => {
    // A reader who saw the component graph yesterday and not today would
    // otherwise conclude the suite stopped sharing components.
    expect(mergeReports(composed()).warnings?.join('\n')).toContain(
      'composition dropped: 1 of 2 shard(s)',
    );
  });

  it('stays silent when no shard composed anything', () => {
    expect(mergeReports(split()).warnings).toBeUndefined();
  });
});

describe('a subject no shard claimed', () => {
  const holed = (): readonly Shard[] => [
    shard('shard-1.json', {
      observations: [observation('story:a')],
      notObserved: [
        { subject: 'story:lost', kind: 'excluded', because: shardFilterBecause(GLOB) },
      ],
    }),
    shard('shard-2.json', {
      observations: [observation('story:b')],
      notObserved: [
        { subject: 'story:lost', kind: 'excluded', because: shardFilterBecause('story:b*') },
      ],
    }),
  ];

  it('becomes a failure rather than an exclusion', () => {
    const merged = mergeReports(holed());
    expect(merged.notObserved).toEqual([
      {
        subject: 'story:lost',
        kind: 'failed',
        because: expect.stringContaining('no shard observed it'),
      },
    ]);
  });

  it('turns the merged run red', () => {
    // The property that makes sharding safe. Each shard exits 0 — every one of
    // them did exactly what it was told — and the suite is missing a component.
    expect(holed().every((entry) => exitFor(entry.report) === 0)).toBe(true);
    expect(exitFor(mergeReports(holed()))).toBe(1);
  });
});

describe('an exclusion somebody meant', () => {
  it('survives, because it is a decision and not a filter', () => {
    const merged = mergeReports([
      shard('shard-1.json', {
        observations: [observation('story:a')],
        notObserved: [
          { subject: 'story:wip', kind: 'excluded', because: 'listed in subjects.exclude' },
        ],
      }),
      shard('shard-2.json', {
        observations: [observation('story:b')],
        notObserved: [
          { subject: 'story:wip', kind: 'excluded', because: 'listed in subjects.exclude' },
        ],
      }),
    ]);

    expect(merged.notObserved).toEqual([
      { subject: 'story:wip', kind: 'excluded', because: 'listed in subjects.exclude' },
    ]);
    expect(exitFor(merged)).toBe(0);
  });

  it('loses to a failure of the same subject in another shard', () => {
    const merged = mergeReports([
      shard('shard-1.json', {
        notObserved: [{ subject: 'story:x', kind: 'excluded', because: 'listed in exclude' }],
      }),
      shard('shard-2.json', {
        notObserved: [{ subject: 'story:x', kind: 'failed', because: 'the browser crashed' }],
      }),
    ]);

    expect(merged.notObserved).toEqual([
      { subject: 'story:x', kind: 'failed', because: 'the browser crashed' },
    ]);
  });
});

describe('one shard that never said what it skipped', () => {
  it('makes the merged coverage absent rather than empty', () => {
    const merged = mergeReports([
      shard('shard-1.json', { observations: [observation('story:a')] }),
      { path: 'shard-2.json', report: { ...report({ observations: [observation('story:b')] }), notObserved: undefined } },
    ]);

    expect(merged.notObserved).toBeUndefined();
    // `undefined` is not `[]`: the merge cannot claim the suite was covered when
    // one of its halves declined to say.
    expect(exitFor(merged)).toBe(1);
  });
});

describe('reports that were never one run', () => {
  const refusal = (shards: readonly Shard[]): string => {
    try {
      mergeReports(shards);
    } catch (error) {
      expect(error).toBeInstanceOf(OperatorError);
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  };

  it('refuses two renderer identities, naming both files', () => {
    const message = refusal([
      shard('linux.json'),
      shard('mac.json', { identity: { ...IDENTITY, platform: 'darwin/arm64' } }),
    ]);
    expect(message).toContain('linux.json');
    expect(message).toContain('mac.json');
    expect(message).toContain('renderer identity');
  });

  it('refuses a durable shard beside an ephemeral one', () => {
    expect(refusal([shard('a.json'), shard('b.json', { retention: 'ephemeral' })])).toContain(
      'retention',
    );
  });

  it('refuses two intents, including when only one shard has one', () => {
    expect(refusal([shard('a.json', { intent: 'restyle' }), shard('b.json')])).toContain('intent');
  });

  it('refuses an unparsable timestamp by file', () => {
    const message = refusal([shard('a.json'), shard('b.json', { at: 'thursday' })]);
    expect(message).toContain('b.json');
    expect(message).toContain('not a date');
  });

  it('refuses nothing to merge', () => {
    expect(refusal([])).toContain('at least one report');
  });
});

describe('globs that overlap', () => {
  it('refuses one subject observed twice', () => {
    expect(() =>
      mergeReports([
        shard('shard-1.json', { observations: [observation('story:a')] }),
        shard('shard-2.json', { observations: [observation('story:a', 'changed')] }),
      ]),
    ).toThrow(/observed by both shard-1.json and shard-2.json/);
  });

  it('refuses one subject both observed and failed', () => {
    expect(() =>
      mergeReports([
        shard('shard-1.json', { observations: [observation('story:a')] }),
        shard('shard-2.json', {
          notObserved: [{ subject: 'story:a', kind: 'failed', because: 'it threw' }],
        }),
      ]),
    ).toThrow(/disagree about whether it was looked at/);
  });
});

describe('the section a split keeps', () => {
  // A subject's names are a fact about one subject, and one subject is in one
  // shard — so the entries concatenate and nothing is a lower bound.
  const named = (): readonly Shard[] => [
    shard('one.json', {
      observations: [observation('story:a')],
      lexicon: {
        version: 1,
        fields: ['example', 'components', 'createdBy', 'regions', 'tokens'],
        subjects: [
          {
            subject: 'story:a',
            boundaries: 2,
            terms: { components: ['Button'], regions: ['Button/onPress'] },
            elided: { regions: 3 },
          },
        ],
      },
    }),
    shard('two.json', {
      observations: [observation('story:b')],
      lexicon: {
        version: 1,
        fields: ['example', 'components', 'createdBy', 'tokens'],
        subjects: [{ subject: 'story:b', boundaries: 1, terms: { components: ['Chip'] } }],
      },
    }),
    shard('three.json', { observations: [observation('story:c')] }),
  ];

  it('carries every subject, in shard order', () => {
    expect(mergeReports(named()).lexicon?.subjects.map((entry) => entry.subject)).toEqual([
      'story:a',
      'story:b',
    ]);
  });

  it('claims only the fields every shard read, and cuts the entries to them', () => {
    // `two.json` ran without a journal. A merged report listing `regions` would
    // send a reader searching a field half the suite never had, and no match
    // there would read as "no subject entered it".
    const merged = mergeReports(named()).lexicon!;
    expect(merged.fields).toEqual(['example', 'components', 'createdBy', 'tokens']);
    expect(merged.subjects[0]).toEqual({
      subject: 'story:a',
      boundaries: 2,
      terms: { components: ['Button'] },
    });
  });

  it('is absent when no shard wrote one', () => {
    expect(mergeReports(split())).not.toHaveProperty('lexicon');
  });

  it('is not what the composition warning is about', () => {
    expect(mergeReports(named()).warnings).toBeUndefined();
  });
});
