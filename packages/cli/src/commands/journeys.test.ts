import { describe, expect, it } from 'vitest';
import type { JourneyDivergence } from '@variance-authority/sense/test-selection';
import { formatJourneys, formatLanding, journeysOf, type JourneysInput, type LandedJourneys } from './journeys.js';

/**
 * The surface over the one instrument that narrows a flake to a place.
 *
 * Almost every assertion here is about the *pool* rather than about the
 * findings. The instrument decides what parted; this decides who was entitled
 * to be a party to it, and every way that decision can go wrong produces the
 * same short list of modules with a different meaning behind it. An empty answer
 * from a pool of one, an empty answer from a pool of forty accumulated across
 * six months, and an empty answer from a repository that has never recorded
 * anything are three different facts printed as the same blank space unless
 * something says otherwise.
 */

const PARTED: JourneyDivergence = {
  file: 'app/src/components/CartCard.tsx',
  observers: ['story:cart-card--item', 'story:cart-card--removing', 'story:cart-card--verbose'],
  parted: [
    {
      kind: 'handler',
      name: 'CartCard/onClick',
      startLine: 51,
      endLine: 58,
      entered: ['story:cart-card--removing'],
      missed: ['story:cart-card--item', 'story:cart-card--verbose'],
    },
  ],
  unentered: [
    {
      kind: 'branch',
      name: 'CartCard/empty',
      startLine: 62,
      endLine: 64,
      entered: [],
      missed: ['story:cart-card--item', 'story:cart-card--removing', 'story:cart-card--verbose'],
    },
  ],
};

/** A reading with a snapshot in it, whose pool is this run's three subjects. */
function reading(over: Partial<JourneysInput> = {}): JourneysInput {
  return {
    at: '/cache/variance-authority/test-selection/abc/coverage.bin',
    recorded: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      whole: PARTED.observers,
      truncated: [],
      unrecorded: [],
      found: [PARTED],
    },
    pool: { kind: 'run', named: 3 },
    ...over,
  };
}

describe('the recorded partings a run can reach', () => {
  it('names the region, who entered it and who did not', () => {
    const text = formatJourneys(journeysOf(reading()));

    expect(text).toContain('app/src/components/CartCard.tsx  3 observers');
    expect(text).toContain('parted     handler CartCard/onClick  51-58');
    expect(text).toContain('entered  story:cart-card--removing');
    expect(text).toContain('missed   story:cart-card--item, story:cart-card--verbose');
    expect(text).toContain('unentered  branch CartCard/empty  62-64');
  });

  it('says which observations the answer is about, findings or none', () => {
    // The sentence a reader needs before the first finding and needs most when
    // there are none. Printed either way, `changelog`'s rule.
    expect(formatJourneys(journeysOf(reading()))).toContain(
      'pool: 3 observations the journal recorded whole, out of 3 subjects the report names',
    );

    const empty = journeysOf(
      reading({ recorded: { whole: PARTED.observers, truncated: [], unrecorded: [], found: [] } }),
    );
    expect(formatJourneys(empty)).toContain('no module was covered differently');
    expect(formatJourneys(empty)).toContain('3 observations the journal recorded whole');
  });

  it('counts a truncated observation rather than letting the pool quietly shrink', () => {
    // The instrument drops these, because a recording that stopped early cannot
    // prove an absence. A pool of two that should have been three is the state
    // this exists to make visible: without the count, the drop reads as agreement.
    const result = journeysOf(
      reading({
        recorded: {
          whole: ['story:cart-card--item', 'story:cart-card--removing'],
          truncated: ['story:cart-card--verbose'],
          unrecorded: [],
          found: [PARTED],
        },
      }),
    );

    expect(result.notes).toContainEqual(
      expect.stringContaining(
        '1 in-scope observation truncated, dropped from the pool rather than counted as ' +
          'having missed anything (story:cart-card--verbose)',
      ),
    );
  });

  it('says which named subjects the journal holds no row for', () => {
    // Not the same as a subject that entered nothing. Nothing was measured, and
    // every finding is silent about them for that reason rather than any other.
    const result = journeysOf(
      reading({
        recorded: {
          whole: ['story:cart-card--item', 'story:cart-card--removing'],
          truncated: [],
          unrecorded: ['story:cart-card--new'],
          found: [PARTED],
        },
      }),
    );

    expect(result.notes).toContainEqual(
      expect.stringContaining('holds no row for 1 named subject (story:cart-card--new)'),
    );
  });

  it('refuses to read a pool that cannot hold two as an absence of partings', () => {
    // A parting is a disagreement between two observers of one module. One
    // observer has not found nothing; it has not been able to look.
    const result = journeysOf(
      reading({
        recorded: {
          whole: ['story:cart-card--item'],
          truncated: [],
          unrecorded: [],
          found: [],
        },
      }),
    );

    expect(result.notes).toContainEqual(
      expect.stringContaining('this pool has fewer, so finding none is not an absence'),
    );
  });

  it('answers nothing, rather than nothing found, when no journal exists', () => {
    // The difference between a suite whose stories all take the same path and a
    // repository that has never recorded which path anything took.
    const result = journeysOf({
      at: '/cache/variance-authority/test-selection/abc/coverage.bin',
      pool: { kind: 'run', named: 3 },
    });

    expect(result.pool).toContain('there is no execution journal at /cache');
    expect(result.notes[0]).toContain('testSelectionProbes()');
    expect(formatJourneys(result)).not.toContain('pool: 3 observations');
  });

  it('states the hazard whenever the pool is the accumulated record', () => {
    // `--all` and "there was no report to read" both widen to the whole
    // snapshot, and both have to carry the reason a widened pool is not this
    // run: a subject deleted two commits ago is still recorded as a party.
    const deliberate = journeysOf(reading({ pool: { kind: 'all' } }));
    expect(deliberate.pool).toContain('the whole journal, as --all asked');
    expect(deliberate.pool).toContain('a deleted subject still counts');

    const fallback = journeysOf(
      reading({ pool: { kind: 'unasked', report: '.variance/report.json' } }),
    );
    expect(fallback.pool).toContain('no report at .variance/report.json');
    expect(fallback.pool).toContain('a deleted subject still counts');
    expect(fallback.pool).toMatch(/a deleted subject still counts$/);
  });

  it('says how stale the record is, or that it cannot say', () => {
    expect(journeysOf(reading()).notes).toContain('recorded at 0123456789ab');

    const nowhere = journeysOf(
      reading({
        recorded: { whole: PARTED.observers, truncated: [], unrecorded: [], found: [PARTED] },
      }),
    );
    expect(nowhere.notes).toContainEqual(
      expect.stringContaining('does not say which commit it was recorded at'),
    );
  });

  it('narrows to the file at the path --file names, and says so when that file is not among the partings', () => {
    const kept = journeysOf(reading({ file: 'app/src/components/CartCard.tsx' }));
    expect(kept.modules.map((module) => module.file)).toEqual(['app/src/components/CartCard.tsx']);

    // A file is its whole path: one whose path holds what was asked, in any case, is another file.
    for (const other of ['CartCard', 'cartcard', 'src/components/CartCard.tsx', 'app/src/components/cartcard.tsx']) {
      const none = journeysOf(reading({ file: other }));
      expect(none.modules).toEqual([]);
      expect(none.notes).toContainEqual(`1 module parted, and ${other}, the path --file named, is not one of them`);
    }
  });

  it('counts what a cap left out', () => {
    // A cap that says nothing reads as coverage, which is the rule every capped
    // answer in this system follows.
    const many = Array.from({ length: 5 }, (_unused, index) => ({
      ...PARTED,
      file: `app/src/components/Card${String(index)}.tsx`,
    }));

    const result = journeysOf(
      reading({
        limit: 2,
        recorded: { whole: PARTED.observers, truncated: [], unrecorded: [], found: many },
      }),
    );

    expect(result.modules).toHaveLength(2);
    expect(result.elided).toBe(3);
    expect(result.notes).toContainEqual(
      expect.stringContaining('3 more parted modules not shown; raise --limit'),
    );
  });
});

describe('formatLanding', () => {
  it('says where the fold went and where it stands, in counts', () => {
    expect(
      formatLanding({
        at: '/cache/variance-authority/test-selection/abc/coverage.bin',
        shards: 3,
        commit: '0123456789abcdef0123456789abcdef01234567',
        observations: 342,
        modules: 1204,
      }),
    ).toBe(
      'folded 3 snapshots into /cache/variance-authority/test-selection/abc/coverage.bin\n' +
        '  342 observations over 1204 modules, recorded at 0123456789ab',
    );
  });

  it('names the shards whose read was not checked', () => {
    const fold = { at: '/tmp/coverage.bin', shards: 3, observations: 2, modules: 1 };
    expect(formatLanding({ ...fold, unchecked: ['/ci/jvm-1.bin', '/ci/jvm-2.bin'] }).split('\n').slice(2)).toEqual([
      '  the reads of /ci/jvm-1.bin and /ci/jvm-2.bin were not checked: their records name the record their selection read `unknown`, ' +
        'so nothing says they chose their tests from the record the other shards read',
    ]);
  });

  it('says what the landing did to the cases of the record it wrote', () => {
    const fold = { at: '/tmp/coverage.bin', shards: 2, observations: 2, modules: 1 };
    const lines = (cases: LandedJourneys['cases']) => formatLanding({ ...fold, cases }).split('\n').slice(2);

    expect(lines({ laid: '/tmp/coverage.bin', shards: 2 })).toEqual([
      '  cases of 2 snapshots laid over /tmp/coverage.bin',
    ]);
    expect(lines({ laid: '/tmp/coverage.bin', shards: 0 })).toEqual([
      '  case index at /tmp/coverage.bin left as it was: no snapshot finished a test file',
    ]);
    expect(lines({ unanswered: '/tmp/coverage.bin', shards: ['/ci/shard-1.bin', '/ci/shard-2.bin'], removed: false })).toEqual([
      '  no case index at /tmp/coverage.bin: /ci/shard-1.bin and /ci/shard-2.bin ran test files to the end, and ' +
        'their records keep no case index this build can read',
    ]);
    expect(lines({ unanswered: '/tmp/coverage.bin', shards: ['/ci/shard-1.bin'], removed: true })).toEqual([
      '  case index removed at /tmp/coverage.bin: /ci/shard-1.bin ran a test file to the end, and ' +
        'its record keeps no case index this build can read, so no index can say which of ' +
        "that file's cases run a line.",
    ]);
    expect(lines({ unlaid: '/tmp/coverage.bin', shards: 1, unfinished: ['test/other.test.ts'] })).toEqual([
      '  no case index at /tmp/coverage.bin: it had none, and 1 snapshot kept cases without running ' +
        'test/other.test.ts to the end, so an index of those cases alone would say no case of that file runs a line.',
    ]);
    expect(lines({ unlaid: '/tmp/coverage.bin', shards: 2, unfinished: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'] })).toEqual([
      '  no case index at /tmp/coverage.bin: it had none, and 2 snapshots kept cases without running ' +
        'test/a.test.ts and 2 other test files to the end, so an index of those cases alone would say no case of ' +
        'those files runs a line.',
    ]);
  });

  it('leaves the position out when the shards had none', () => {
    expect(formatLanding({ at: '/tmp/coverage.bin', shards: 1, observations: 1, modules: 1 })).toBe(
      'folded 1 snapshot into /tmp/coverage.bin\n  1 observation over 1 module',
    );
  });
});
