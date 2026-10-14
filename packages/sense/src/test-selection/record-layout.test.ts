import { describe, expect, it } from 'vitest';

import type { BlockKind } from '../instrument/index.js';
import { BLOCK_KINDS, DURATION, FORMAT, NAMES, NO_DURATION, NO_OWNER } from './format-layout.js';
import { LAYOUT } from './record-layout.js';

describe('the record layout both sides read', () => {
  it('numbers every block kind the instrumenter names, and nothing else', () => {
    // A record of every kind: a kind added to `BlockKind` fails the build here until it is listed.
    const every: Record<BlockKind, null> = {
      module: null, function: null, branch: null, continuation: null, resume: null, loop: null, case: null, handler: null,
    };
    expect([...BLOCK_KINDS].sort()).toEqual(Object.keys(every).sort());
  });

  it('is where the format constants come from', () => {
    expect(FORMAT).toBe(LAYOUT.coverage.format);
    expect([...NAMES, DURATION].sort()).toEqual([...LAYOUT.coverage.sections].sort());
    expect([NO_OWNER, NO_DURATION]).toEqual([0xffff_ffff, 0xffff_ffff]);
  });
});
