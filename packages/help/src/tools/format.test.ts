import { describe, expect, it } from 'vitest';
import { byFile, chainsEnd, ownSteps } from './format.js';

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

describe('rows said by file', () => {
  it('names a file once over several rows, and puts what a row adds under it, one step deeper', () => {
    const rows = [
      { file: 'a.ts', line: 3, text: '  one' },
      { file: 'b.ts', line: 1, text: 'two', note: 'in branch 1-2' },
      { file: 'b.ts', line: 9, text: 'three', note: 'in function f 9-9' },
    ];
    expect(byFile(rows)).toEqual(['a.ts:3: one', 'b.ts', '  1: two', '    in branch 1-2', '  9: three', '    in function f 9-9']);
    expect(byFile([rows[1]!])).toEqual(['b.ts:1: two', '  in branch 1-2']);
  });
});
