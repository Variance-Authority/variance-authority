import type { TestComposition } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { formatTestComposition } from './test-composition-format.js';

const test = (case_: number, file: string, name: string, blocks: number) => ({ case: case_, file, name, blocks });
const at = (kind: string, file: string, line: number, end: number, fn?: string) => ({ kind, file, line, end, ...(fn === undefined ? {} : { function: fn }) });

const composition: TestComposition = {
  suite: 8,
  test: test(1, 'b.test.ts', 'b uses a', 5),
  structure: 1,
  alike: 0,
  pieces: [{ case: test(0, 'a.test.ts', 'a unit', 2), shared: 2 }],
  wholes: [{ case: test(4, 'e2e.test.ts', 'end to end', 6), shared: 5 }],
  explained: 2,
  own: [at('function', 'src/b.ts', 1, 9, 'b'), at('branch', 'src/b.ts', 3, 4, 'b')],
  reached: [at('branch', 'src/a.ts', 6, 7, 'a')],
};

describe('a test composition as text', () => {
  it('states the footprint against the suite, then its pieces, wholes, and the residue split in two', () => {
    expect(formatTestComposition(composition).split('\n')).toEqual([
      'b.test.ts  b uses a: a footprint of 5 regions; 1 more is structure, run by more than half of the 8 recorded tests.',
      '',
      'Pieces, smaller tests inside it, most shared first:',
      '  a.test.ts  a unit  (2 of its 2 regions inside it)',
      '',
      'Wholes, larger tests holding it, smallest first:',
      '  e2e.test.ts  end to end  (6 regions, 5 of the 5 inside it)',
      '',
      'Pieces ran 2 of its 5 regions. The other 3 no piece ran:',
      'Its own layer, in modules no piece ran:',
      '  src/b.ts:1-9  function b',
      '  src/b.ts:3-4  branch in b',
      'Paths of a piece\'s modules only it takes; a test nearer that code would run them more cheaply:',
      '  src/a.ts:6-7  branch in a',
    ]);
  });

  it('says a test with no pieces is all its own, and names the tests alike rather than listing them as pieces', () => {
    const alone = { ...composition, alike: 2, pieces: [], wholes: [], explained: 0, reached: [] };
    expect(formatTestComposition(alone).split('\n')).toEqual([
      'b.test.ts  b uses a: a footprint of 5 regions; 1 more is structure, run by more than half of the 8 recorded tests.',
      '2 other tests ran exactly the same regions.',
      '',
      'No smaller test sits inside it and no larger test holds it.',
      '',
      'No piece ran any of its 5 regions:',
      'Its own layer, in modules no piece ran:',
      '  src/b.ts:1-9  function b',
      '  src/b.ts:3-4  branch in b',
    ]);
  });

  it('stops at the count when everything the test entered is structure', () => {
    const shared = { ...composition, test: test(5, 's.test.ts', 'setup one', 0), structure: 3, pieces: [], wholes: [], explained: 0, own: [], reached: [] };
    expect(formatTestComposition(shared)).toBe(
      's.test.ts  setup one: an empty footprint; all 3 regions it ran are structure, run by more than half of the 8 recorded tests.',
    );
    expect(formatTestComposition({ ...shared, structure: 0 })).toBe('s.test.ts  setup one: an empty footprint; it ran no recorded region.');
  });

  it('lists twelve rows of a part and counts the rest', () => {
    const many = { ...composition, own: Array.from({ length: 14 }, (_, line) => at('branch', 'src/b.ts', line + 1, line + 1)), reached: [] };
    const lines = formatTestComposition(many).split('\n');
    expect(lines.at(-1)).toBe('  and 2 more');
    expect(lines.at(-2)).toBe('  src/b.ts:12  branch');
  });
});
