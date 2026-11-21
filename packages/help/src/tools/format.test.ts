import { describe, expect, it } from 'vitest';
import { chainsEnd, ownSteps } from './format.js';

describe('a chain tail said once', () => {
  it('stops short of a row whose whole chain is the tail of another', () => {
    const chains = [
      ['view.ts', 'model.ts', 'base.ts'],
      ['page.ts', 'view.ts', 'model.ts', 'base.ts'],
    ];
    const end = chainsEnd(chains);
    expect(end).toEqual(['model.ts', 'base.ts']);
    // Each row keeps its own file, and the shared end is never also its first step.
    expect(chains.map((chain) => ownSteps(chain, end))).toEqual(['view.ts → …', 'page.ts → view.ts → …']);
  });

  it('says nothing for one chain, or chains that end apart', () => {
    expect(chainsEnd([['a.ts', 'b.ts']])).toEqual([]);
    expect(chainsEnd([['a.ts', 'b.ts'], ['c.ts', 'd.ts']])).toEqual([]);
  });
});
