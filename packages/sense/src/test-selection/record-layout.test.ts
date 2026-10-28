import { describe, expect, it } from 'vitest';

import type { BlockKind } from '../instrument/index.js';
import { BLOCK_KINDS, DURATION, FORMAT, NAMES, NO_DURATION, NO_OWNER, PHASES } from './format-layout.js';
import { LAYOUT, type RecordLayout } from './record-layout.js';

describe('the record layout both sides read', () => {
  it('numbers every block kind the instrumenter names, and nothing else', () => {
    // A record of every kind, in the order their numbers were given: a kind
    // added to `BlockKind` fails the build here until it is listed, and the
    // list only grows at its end, since a kind's number is its place in it.
    const every: Record<BlockKind, null> = {
      module: null, function: null, branch: null, continuation: null, resume: null, loop: null, case: null, handler: null,
    };
    expect(BLOCK_KINDS).toEqual(Object.keys(every));
  });

  it('is where the format constants come from', () => {
    expect(FORMAT).toBe(LAYOUT.coverage.format);
    expect([...NAMES, DURATION, PHASES].sort()).toEqual([...LAYOUT.coverage.sections].sort());
    expect([NO_OWNER, NO_DURATION]).toEqual([0xffff_ffff, 0xffff_ffff]);
  });

  it('spares every kind under an edit that changes nothing that runs, and the top level under a body edit', () => {
    expect(LAYOUT.coverage.spared).toEqual({ none: BLOCK_KINDS, bodies: ['module'] });
  });

  it('holds the fields RecordLayout declares, and only those', () => {
    // Each list names every key of its object, or this file does not compile;
    // the JSON is held to the lists, so a key on one side only fails here. The
    // addon reads the same file and stops on a field it needs and cannot find.
    type Keys<T> = { readonly [K in keyof T]-?: true };
    const top: Keys<RecordLayout> = { alignment: true, packAbove: true, run: true, blobRun: true, codecs: true, levels: true, coverage: true, sets: true, cases: true };
    const nested: { readonly [K in 'codecs' | 'levels' | 'coverage' | 'sets' | 'cases']: Keys<RecordLayout[K]> } = {
      codecs: { raw: true, zstd: true },
      levels: { numbers: true, text: true },
      coverage: {
        model: true, format: true, unphased: true, uncased: true, untimed: true, noOwner: true, noDuration: true, noLine: true,
        sections: true, duration: true, phases: true, phaseNames: true, parts: true, blockKinds: true, spared: true,
      },
      sets: { list: true, bits: true, runs: true, narrow: true },
      cases: { format: true, loadedSets: true, duration: true, lines: true, linesOffsets: true },
    };
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(LAYOUT)).toEqual(keys(top));
    for (const [section, fields] of Object.entries(nested)) {
      expect([section, keys(LAYOUT[section as keyof typeof nested])]).toEqual([section, keys(fields)]);
    }
  });
});
