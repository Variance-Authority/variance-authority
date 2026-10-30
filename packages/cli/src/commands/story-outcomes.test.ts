import { describe, expect, it } from 'vitest';
import type { OutcomeComparison } from '@variance-authority/sense/story';
import { formatOutcomes } from './story-outcomes.js';

describe('outcomes of one case compared from the record', () => {
  const page = { file: 'src/page.ts', startLine: 3, endLine: 5 };
  const OUTCOMES: OutcomeComparison = {
    file: 'test/page.test.ts',
    name: 'clicks',
    passed: 2,
    threw: 2,
    onlyPassed: [{ ...page, name: 'wire', path: 'entry' }],
    onlyThrew: [],
    moved: [{ region: { ...page, name: 'wire', path: 'entry' }, passed: { line: 4 }, threw: { line: 6 } }],
    unsteady: 3,
    single: false,
  };

  it('prints each region by how its charge moved with the outcome, and counts what moves within one', () => {
    expect(formatOutcomes(OUTCOMES, 'text')).toBe(`${[
      'compare  test/page.test.ts > clicks, from the readings the record keeps',
      '  passed (2 runs) against threw (2 runs)',
      '',
      '  charged to a later line when it threw, on every run:',
      '    wire  src/page.ts:3-5  line 4 when it passed, line 6 when it threw',
      '',
      '  reached only when it passed, on every run:',
      '    wire  src/page.ts:3-5',
      '',
      '  left out, because they differ between runs of one outcome as well: 3 regions',
    ].join('\n')}\n`);
  });

  it('says nothing separates the outcomes, and warns of a side read once', () => {
    const text = formatOutcomes({ ...OUTCOMES, threw: 1, onlyPassed: [], moved: [], unsteady: 0, single: true }, 'text');

    expect(text).toContain('one run on a side');
    expect(text).toContain('nothing separates the outcomes');
  });
});
