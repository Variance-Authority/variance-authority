import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { ranOver, type RanOverEvidence } from './place-text.js';
import type { Placement } from './placed.js';
import type { TestPlace } from './test-places.js';

/**
 * Which text of an asked file a run ran over is read from what the record
 * says of the run: the digests its landing names, the commit it stood at, and,
 * for the one run that wrote a snapshot naming no commit, the snapshot's rows.
 */

const HELD = 'export const a = 1;\n';
const OTHER = 'export const a = 2;\n';
const FILE = 'src/a.ts';
const TEST = 'test/a.test.ts';
const LAST = '2026-01-02T00:00:00.000Z';

const evidence: RanOverEvidence = {
  repository: true,
  committed: new Map([['C', new Map([[FILE, HELD]])], ['D', new Map([[FILE, OTHER]])]]),
  absent: new Map([['E', new Set([FILE])]]),
  blobs: new Map(),
  kept: new Map([[digestString(OTHER), OTHER]]),
  last: LAST,
  placements: new Map(),
  ranOther: undefined,
};

const placed = (frame: Placement['frame'], recorded?: string): Placement => ({
  frame,
  ...(recorded === undefined ? {} : { recorded }),
  place: () => undefined,
  recordedLine: () => undefined,
});

describe('which text of a file a run ran over', () => {
  it('reads the text a landing names, the kept one when it is another, and the commit\'s where it names none', () => {
    expect(ranOver({ commit: 'D', texts: { [FILE]: digestString(HELD) } }, TEST, FILE, HELD, evidence, false)).toBe('held');
    expect(ranOver({ commit: 'C', texts: { [FILE]: digestString(OTHER) } }, TEST, FILE, HELD, evidence, false)).toEqual({ text: OTHER, name: digestString(OTHER) });
    expect(ranOver({ commit: 'C', texts: { [FILE]: digestString('kept nowhere') } }, TEST, FILE, HELD, evidence, false)).toEqual({ text: undefined });
    expect(ranOver({ commit: 'C', texts: {} }, TEST, FILE, HELD, evidence, false)).toBe('held');
    expect(ranOver({ commit: 'D', texts: {} }, TEST, FILE, HELD, evidence, false)).toEqual({ text: OTHER });
    expect(ranOver({ commit: 'E', texts: {} }, TEST, FILE, HELD, evidence, false)).toBe('absent');
  });

  it('tells the held text by its names, reading no text of it, and hands back the text a run ran instead', () => {
    // By name the commit that holds the held text is not read, so only D's text is in hand.
    const named: RanOverEvidence = {
      ...evidence,
      committed: new Map([['D', new Map([[FILE, OTHER]])]]),
      blobs: new Map([['C', new Map([[FILE, 'git:held']])], ['D', new Map([[FILE, 'git:other']])]]),
    };
    const held = { blob: 'git:held', digest: digestString(HELD) };
    expect(ranOver({ commit: 'D', texts: { [FILE]: digestString(HELD) } }, TEST, FILE, held, named, false)).toBe('held');
    expect(ranOver({ commit: 'C', texts: {} }, TEST, FILE, held, named, false)).toBe('held');
    expect(ranOver({ commit: 'D', texts: {} }, TEST, FILE, held, named, false)).toEqual({ text: OTHER, name: 'git:other' });
    expect(ranOver({ commit: 'C', texts: { [FILE]: digestString(OTHER) } }, TEST, FILE, held, named, false)).toEqual({ text: OTHER, name: digestString(OTHER) });
    // Rows cut from another text name no digest of the held one, so a run naming one did not run it.
    expect(ranOver({ commit: 'D', texts: { [FILE]: digestString(HELD) } }, TEST, FILE, { blob: 'git:held', digest: undefined }, named, false)).toEqual({ text: undefined });
    expect(ranOver({ commit: 'E', texts: {} }, TEST, FILE, held, named, false)).toBe('absent');
    // The run that wrote the snapshot ran its rows' text, which is the held one when the rows name it.
    const wrote: TestPlace = { first: LAST, latest: LAST };
    expect(ranOver(wrote, TEST, FILE, held, named, false)).toBe('held');
    expect(ranOver(wrote, TEST, FILE, { blob: 'git:held', digest: undefined }, named, false)).toEqual({ text: undefined, rows: true });
  });

  it('hands back the commit\'s text for a digest a run names that no landing kept, when the commit\'s text is the one it names', () => {
    // The text is read from the commit's history, never from disk: the record keeps nothing of it.
    const unkept: RanOverEvidence = { ...evidence, kept: new Map() };
    expect(ranOver({ commit: 'D', texts: { [FILE]: digestString(OTHER) } }, TEST, FILE, HELD, unkept, false)).toEqual({ text: OTHER, name: digestString(OTHER) });
    const named: RanOverEvidence = {
      ...unkept,
      committed: new Map([['D', new Map([[FILE, OTHER]])]]),
      blobs: new Map([['D', new Map([[FILE, 'git:other']])]]),
    };
    expect(ranOver({ commit: 'D', texts: { [FILE]: digestString(OTHER) } }, TEST, FILE, { blob: 'git:held', digest: digestString(HELD) }, named, false))
      .toEqual({ text: OTHER, name: digestString(OTHER) });
    // A digest the commit's text is not stays not found.
    expect(ranOver({ commit: 'C', texts: { [FILE]: digestString(OTHER) } }, TEST, FILE, HELD, unkept, false)).toEqual({ text: undefined });
  });

  it('says why it is not known for a run the record could not place, one naming no texts, and one at a commit this clone lacks', () => {
    const unknown = (run: TestPlace, of = evidence) => ranOver(run, TEST, FILE, HELD, of, false);
    expect(unknown({ commit: 'C', assumed: true })).toEqual({ unknown: `the record does not say where that run stood, so not which text of ${FILE} it ran over` });
    expect(unknown({ commit: 'C' })).toEqual({ unknown: `the runs record does not say which text of ${FILE} its runs there ran over` });
    expect(unknown({ commit: 'F', texts: {} })).toEqual({ unknown: `this clone holds no committed text of ${FILE} where that run stood` });
    expect(unknown({ commit: 'F', texts: {} }, { ...evidence, repository: false })).toEqual({ unknown: `the checkout is in no git repository, so no committed text of ${FILE} can be read` });
  });

  it('reads the snapshot\'s rows for the run that wrote a snapshot naming no commit', () => {
    const wrote: TestPlace = { first: LAST, latest: LAST };
    const rows = (placement: Placement | undefined, ranOther?: ReadonlyMap<string, readonly string[]>) => ({
      ...evidence,
      placements: new Map(placement === undefined ? [] : [[FILE, placement]]),
      ranOther,
    });
    expect(ranOver(wrote, TEST, FILE, HELD, rows(placed('recorded', HELD)), false)).toBe('held');
    expect(ranOver(wrote, TEST, FILE, HELD, rows(placed('mapped', OTHER)), false)).toEqual({ text: OTHER });
    expect(ranOver(wrote, TEST, FILE, HELD, rows(undefined), false)).toEqual({ unknown: `the record holds no digest of the text of ${FILE} it ran over` });
    expect(ranOver(wrote, TEST, FILE, HELD, rows(undefined, new Map([[FILE, [TEST]]])), true)).toEqual({ text: undefined });
    expect(ranOver(wrote, TEST, FILE, HELD, rows(undefined, new Map([[FILE, ['test/b.test.ts']]])), true)).toBe('held');
    // An earlier landing's rows a later run may have written over.
    expect(ranOver({ first: '2026-01-01T00:00:00.000Z', latest: '2026-01-01T00:00:00.000Z' }, TEST, FILE, HELD, rows(placed('recorded', HELD)), false))
      .toEqual({ unknown: `the runs record does not say which text of ${FILE} its runs there ran over` });
  });
});
