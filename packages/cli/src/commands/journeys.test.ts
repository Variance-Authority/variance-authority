import { describe, expect, it } from 'vitest';
import type { JourneyDivergence } from '@variance-authority/sense/test-selection';
import { formatJourneys, formatLanding, journeysOf, type JourneysInput } from './journeys.js';

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
    expect(formatJourneys(empty)).toContain('no module was entered differently');
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
      expect.stringContaining('this pool cannot hold two, so nothing above is an absence'),
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
    expect(deliberate.pool).toContain('--all asked for the accumulated record');
    expect(deliberate.pool).toContain('deleted two commits ago is still a party');

    const fallback = journeysOf(
      reading({ pool: { kind: 'unasked', report: '.variance/report.json' } }),
    );
    expect(fallback.pool).toContain('no report at .variance/report.json');
    expect(fallback.pool).toContain('deleted two commits ago is still a party');
    expect(fallback.pool).toContain('pass --all to ask for the record on purpose');
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

  it('narrows by file and says so when the filter is what emptied the answer', () => {
    const kept = journeysOf(reading({ file: 'cartcard' }));
    expect(kept.modules).toHaveLength(1);

    const none = journeysOf(reading({ file: 'MainNav' }));
    expect(none.modules).toEqual([]);
    expect(none.notes).toContainEqual(
      expect.stringContaining('1 module parted and none of them matches --file MainNav'),
    );
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

  it('leaves the position out when the shards had none', () => {
    expect(formatLanding({ at: '/tmp/coverage.bin', shards: 1, observations: 1, modules: 1 })).toBe(
      'folded 1 snapshot into /tmp/coverage.bin\n  1 observation over 1 module',
    );
  });
});
