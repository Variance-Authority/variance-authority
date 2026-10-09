import { describe, expect, it } from 'vitest';
import {
  atDistance,
  type ExecutionNarrowing,
  type TestDistance,
} from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { inLeg } from './select-leg.js';
import { formatSelection, selectionNotes, skippableTests, type SelectInput } from './select.js';

/**
 * `variance select --at-distance`: one leg of the selection, as a skip list.
 *
 * The leg is the same one a seam runs under `VARIANCE_AUTHORITY_AT_DISTANCE`, so the
 * cases below hold the two together on the property that makes a loop of legs
 * safe: `0-2` and then `3-` run every selected file, and a selection that
 * declines to narrow skips nothing whichever leg was asked.
 */

const NEAR = 'test/near.test.ts';
const MID = 'test/mid.test.ts';
const FAR = 'test/far.test.ts';
const GHOST = 'test/ghost.test.ts';
const IDLE = 'test/idle.test.ts';
const PARTIAL = 'test/partial.test.ts';
const WHOLE = [FAR, GHOST, IDLE, MID, NEAR];
const DISTANCES: readonly TestDistance[] = [
  { test: NEAR, bearing: 'direct', hops: 1 },
  { test: MID, bearing: 'transitive', hops: 2 },
  { test: FAR, bearing: 'transitive', hops: 3 },
  { test: GHOST, bearing: 'unexplained' },
];

function read(distances: readonly TestDistance[] = DISTANCES, incomplete?: readonly string[]): SelectInput {
  const narrowing: ExecutionNarrowing = {
    whole: WHOLE,
    ...(incomplete === undefined ? {} : { incomplete }),
    entered: [FAR, GHOST, MID, NEAR],
    unread: [],
    stale: [],
    because: [],
  };
  return { at: '/cache/coverage.bin', commit: 'c0ffee', ground: { kind: 'read', narrowing, distances } };
}

describe('--at-distance on the command line', () => {
  it('reads a range of hop counts', () => {
    expect(parseArgs(['select', '--at-distance', '0-2'])).toMatchObject({ atDistance: { from: 0, to: 2 } });
    expect(parseArgs(['select', '--at-distance', '3-'])).toMatchObject({ atDistance: { from: 3 } });
  });

  it('refuses what is not a range of hop counts', () => {
    expect(() => parseArgs(['select', '--at-distance', '0-e'])).toThrow(/--at-distance takes hop counts/);
  });
});

describe('one leg of the selection', () => {
  it('leaves the selection alone when no leg is asked', () => {
    const input = read();
    expect(inLeg(skippableTests(input), input, undefined)).toEqual(skippableTests(input));
  });

  it('skips the tests further out than the leg, and names them as left', () => {
    const input = read();
    const selection = inLeg(skippableTests(input), input, { from: 0, to: 2 });

    // The ghost has no measured distance, and runs in the end leg: `3-`, since FAR is past 2.
    expect(selection.skip).toEqual([FAR, GHOST, IDLE]);
    expect(selection.left).toEqual([FAR, GHOST]);
    expect(selection.leg).toEqual({ from: 0, to: 2 });
    expect(selection.widened).toBeUndefined();
  });

  it('skips the tests nearer than an open leg, and runs the unplaced with it', () => {
    const input = read();
    const selection = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(selection.skip).toEqual([IDLE, MID, NEAR]);
    expect(selection.left).toEqual([MID, NEAR]);
    expect(selection.leg).toEqual({ from: 3 });
  });

  it('runs each selected file in one of `0-2` and `3-`', () => {
    const input = read();
    const runs = (from: number, to: number) => {
      const { skip } = inLeg(skippableTests(input), input, { from, to });
      return WHOLE.filter((test) => !skip.includes(test));
    };

    expect([...runs(0, 2), ...runs(3, Number.MAX_SAFE_INTEGER)].sort()).toEqual([FAR, GHOST, MID, NEAR]);
    expect(runs(0, 2)).toEqual([...atDistance(DISTANCES, 0, 2)].sort());
  });

  it('runs an entered test with no hop count in `0-2` and not in `3-` when nothing is placed past two hops', () => {
    const input = read([
      { test: NEAR, bearing: 'direct', hops: 0 },
      { test: MID, bearing: 'transitive', hops: 1 },
      { test: FAR, bearing: 'transitive', hops: 2 },
      { test: GHOST, bearing: 'unexplained' },
    ]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual([IDLE]);
    expect(end.skip).toEqual(WHOLE);
    expect(end.left).toEqual([FAR, GHOST, MID, NEAR]);
  });

  it('runs each selected file once in any loop of legs that covers every hop', () => {
    const OPEN = Number.MAX_SAFE_INTEGER;
    const loops = [
      [[0, 2], [3, OPEN]],
      [[0, 1], [2, OPEN]],
      [[0, 0], [1, OPEN]],
    ] as const;
    const readings: readonly (readonly TestDistance[])[] = [
      [],
      [{ test: NEAR, bearing: 'direct', hops: 0 }],
      [{ test: NEAR, bearing: 'direct', hops: 0 }, { test: MID, bearing: 'transitive', hops: 1 }],
      [{ test: NEAR, bearing: 'direct', hops: 1 }, { test: MID, bearing: 'transitive', hops: 2 }],
      DISTANCES,
    ];

    for (const distances of readings) {
      const input = read(distances);
      for (const loop of loops) {
        const ran = loop.flatMap(([from, to]) => {
          const { skip } = inLeg(skippableTests(input), input, { from, to });
          return WHOLE.filter((test) => !skip.includes(test));
        });
        expect(ran.sort(), `${JSON.stringify(distances)} over ${JSON.stringify(loop)}`).toEqual([FAR, GHOST, MID, NEAR]);
      }
    }
  });

  it('sends the unplaced an open leg left to the earlier leg that holds the furthest hop', () => {
    const input = read([
      { test: NEAR, bearing: 'direct', hops: 0 },
      { test: MID, bearing: 'transitive', hops: 1 },
      { test: FAR, bearing: 'transitive', hops: 2 },
      { test: GHOST, bearing: 'unexplained' },
    ]);
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER }));

    expect(err).toContain(
      '4 selected test files are left for an earlier leg, nearer than 3 hops: the same command with `--at-distance 0-2` runs them',
    );
    expect(err).not.toContain('for a later leg');
  });

  // The earlier leg landed its run, and this reading is the one after it: what
  // that leg ran is at HEAD, and the rest is read from where it last ran.
  it('runs in the open leg the nearer tests a run landed at HEAD left standing, placed or not', () => {
    const input = read([
      { test: NEAR, bearing: 'direct', hops: 0 },
      { test: MID, bearing: 'transitive', hops: 1 },
      { test: FAR, bearing: 'transitive', hops: 2 },
      { test: GHOST, bearing: 'unexplained' },
    ]);
    const after: SelectInput = input.ground.kind === 'read' ? { ...input, ground: { ...input.ground, unrunAtHead: [GHOST, MID] } } : input;
    const end = inLeg(skippableTests(after), after, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(end.skip).toEqual([FAR, IDLE, NEAR]);
    expect(end.left).toEqual([FAR, NEAR]);
    expect(selectionNotes(end)).toContain(
      '2 selected test files nearer than 3 hops run in this leg: they last ran before HEAD, and the run that landed at HEAD did not run them',
    );
  });

  it('leaves the tests standing before HEAD to the leg that starts at 0 hops', () => {
    const input = read();
    const after: SelectInput = input.ground.kind === 'read' ? { ...input, ground: { ...input.ground, unrunAtHead: [FAR, MID] } } : input;

    expect(inLeg(skippableTests(after), after, { from: 0, to: 2 }).skip).toEqual([FAR, GHOST, IDLE]);
  });

  it('runs an entered test with no distance in the open leg when no hop was measured', () => {
    const input = read([]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual(WHOLE);
    expect(end.skip).toEqual([IDLE]);
  });

  it('cuts an entered test the record never saw whole, and counts it apart from the whole', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: { whole: WHOLE, entered: [FAR, GHOST, MID, NEAR, PARTIAL], unread: [], stale: [], because: [] },
        distances: [...DISTANCES, { test: PARTIAL, bearing: 'direct', hops: 1 }],
      },
    };
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(end.skip).toEqual([IDLE, MID, NEAR, PARTIAL]);
    expect(selectionNotes(end)).toContain('skipping 4 test files: 1 of 5 recorded whole covered no changed line, and 3 are outside');
  });

  it('runs a test the record holds incomplete, with no path to the change, only in the open leg', () => {
    const SKIPPED = 'test/skipped.test.ts';
    const input = read(DISTANCES, [GHOST, SKIPPED]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual([FAR, GHOST, IDLE, SKIPPED]);
    expect(near.left).toEqual([FAR, GHOST, SKIPPED]);
    expect(end.skip).toEqual([IDLE, MID, NEAR]);
    expect(selectionNotes(near)).toContain(
      '1 test file the record never saw whole and the change did not enter is left for the open leg',
    );
  });

  // A placed incomplete test is measured like an entered one, so it can be the
  // furthest test of the reading: a closed leg short of it is no end leg, and an
  // entered test with no distance waits for the one that is: GHOST runs in
  // `0-2` while NEAR is the furthest, and moves to `3-` once PARTIAL is placed.
  it('runs an unplaced entered test only in the leg past a placed incomplete test', () => {
    const reading = (incomplete: readonly string[]): SelectInput => ({
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: { whole: WHOLE, incomplete, entered: [GHOST, NEAR], unread: [], stale: [], because: [] },
        distances: [
          { test: NEAR, bearing: 'direct', hops: 1 },
          { test: GHOST, bearing: 'unexplained' },
          { test: PARTIAL, bearing: 'transitive', hops: 3 },
        ],
      },
    });
    const input = reading([PARTIAL]);
    const alone = reading([]);
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toEqual([FAR, GHOST, IDLE, MID, PARTIAL]);
    expect(end.skip).toEqual([FAR, IDLE, MID, NEAR]);
    expect(inLeg(skippableTests(alone), alone, { from: 0, to: 2 }).skip).toEqual([FAR, IDLE, MID]);
    // stderr names the leg that runs GHOST from the same reading the cut used.
    expect(selectionNotes(near)).toContain(
      '1 at no measured distance, which runs in the leg that holds 3 hops, the furthest measured',
    );
  });

  // A caller hands over its own distances, and one may name an incomplete test
  // it could not place. Placed means a hop count, not a row: a closed end leg
  // runs an entered test with no hops, never an incomplete one.
  it('runs an incomplete test with a distance but no hops only in the open leg', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: { whole: WHOLE, incomplete: [PARTIAL], entered: [NEAR], unread: [], stale: [], because: [] },
        distances: [
          { test: NEAR, bearing: 'direct', hops: 1 },
          { test: PARTIAL, bearing: 'unexplained' },
        ],
      },
    };
    const near = inLeg(skippableTests(input), input, { from: 0, to: 2 });
    const end = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).toContain(PARTIAL);
    expect(selectionNotes(near)).not.toContain('placed in this leg');
    expect(end.skip).not.toContain(PARTIAL);
  });

  it('names what the leg left and the leg that runs it, on stderr', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 0, to: 2 }));

    expect(err).toContain('skipping 3 test files: 1 of 5 recorded whole covered no changed line, and 2 are outside `--at-distance 0-2`');
    expect(err).toContain('2 selected test files are left for a later leg');
    expect(err).toContain('`--at-distance 3-`');
  });

  it('names the nearer leg when an open leg leaves the near tests', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER }));

    expect(err).toContain('2 selected test files are left for an earlier leg, nearer than 3 hops');
    expect(err).toContain('`--at-distance 0-2`');
  });

  it('names both legs, each spelled as typed, when a middle leg leaves tests on either side', () => {
    const input = read([
      { test: NEAR, bearing: 'direct', hops: 0 },
      { test: MID, bearing: 'transitive', hops: 1 },
      { test: FAR, bearing: 'transitive', hops: 2 },
      { test: GHOST, bearing: 'unexplained' },
    ]);
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 1, to: 1 }));

    expect(err).toContain('outside `--at-distance 1`;');
    expect(err).toContain('2 selected test files are left for a later leg: the same command with `--at-distance 2-` runs them');
    expect(err).toContain(
      '1 selected test file is left for an earlier leg, nearer than 1 hop: the same command with `--at-distance 0` runs it',
    );
  });

  it('writes the leg and what it left into json', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, { from: 0, to: 2 }), 'json', '/repo'));

    expect(json.leg).toEqual({ from: 0, to: 2 });
    expect(json.left).toEqual([FAR, GHOST]);
  });

  it('writes how far the change travelled to each test it entered into json, beside the leg', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, { from: 0, to: 2 }), 'json', '/repo'));

    expect(json.distances).toEqual([
      { test: FAR, bearing: 'transitive', hops: 3 },
      { test: GHOST, bearing: 'unexplained' },
      { test: MID, bearing: 'transitive', hops: 2 },
      { test: NEAR, bearing: 'direct', hops: 1 },
    ]);
  });

  it('counts the selection by hops on stderr, so the next leg can be chosen from it', () => {
    const input = read();
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 0, to: 2 }));

    expect(err).toContain(
      'the change entered 4 test files: 1 at 1 hop, 1 at 2 hops, 1 at 3 hops, ' +
        'and 1 at no measured distance, which runs in the leg that holds 3 hops, the furthest measured',
    );
  });

  it('counts the unplaced as running in the open leg when no hop was measured', () => {
    const input = read([]);
    const err = selectionNotes(inLeg(skippableTests(input), input, { from: 0, to: 2 }));

    expect(err).toContain('the change entered 4 test files: 4 at no measured distance, which run in the open leg');
  });

  it('counts no distances when the change entered no test', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: { whole: WHOLE, entered: [], unread: [], stale: [], because: [] }, distances: [] },
    };
    const selection = inLeg(skippableTests(input), input, { from: 0, to: 2 });

    expect(selection.left).toEqual([]);
    expect(selectionNotes(selection)).not.toContain('the change entered');
  });

  it('writes no leg into json when none was asked', () => {
    const input = read();
    const json = JSON.parse(formatSelection(inLeg(skippableTests(input), input, undefined), 'json', '/repo'));

    expect(json).not.toHaveProperty('leg');
    expect(json).not.toHaveProperty('left');
    expect(json).not.toHaveProperty('distances');
  });

  it.each([
    ['no-journal', { kind: 'no-journal' }],
    ['no-coverage', { kind: 'no-coverage' }],
    ['no-diff', { kind: 'no-diff', from: 'origin/main' }],
    ['no-install', { kind: 'no-install', whole: 'the lockfile at origin/main could not be read' }],
    ['before', { kind: 'before', whole: 'vitest.setup.ts changed' }],
  ] as const)('skips nothing in any leg when the ground is %s', (_, ground) => {
    const input: SelectInput = { at: '/cache/coverage.bin', ground };
    for (const leg of [{ from: 0, to: 2 }, { from: 3, to: Number.MAX_SAFE_INTEGER }]) {
      const selection = inLeg(skippableTests(input), input, leg);
      expect(selection.skip).toEqual([]);
      expect(selection.left).toEqual([]);
      expect(selectionNotes(selection)).toContain('skipping nothing');
    }
  });

  it('skips nothing in any leg when nothing was recorded whole', () => {
    const input: SelectInput = {
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: { whole: [], entered: [], unread: [], stale: [], because: [] }, distances: [] },
    };
    const selection = inLeg(skippableTests(input), input, { from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(selection.skip).toEqual([]);
    expect(selection.left).toEqual([]);
  });

  it('refuses a leg over a journey file, which measures no hops', () => {
    const input: SelectInput = { ...read(), given: true };
    expect(() => inLeg(skippableTests(input), input, { from: 0, to: 2 })).toThrow(/journey file/);
  });
});
